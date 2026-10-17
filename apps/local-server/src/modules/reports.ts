import { all, one, type DB } from '../database/db.ts';

export function dailySummary(db: DB, date: string) {
  const totals = one<{ count: number; total: number | null; vat: number | null; discount: number | null }>(
    db,
    `SELECT COUNT(*) AS count, SUM(total_kurus) AS total, SUM(vat_kurus) AS vat, SUM(discount_kurus) AS discount
       FROM pos_sales WHERE status = 'tamamlandi' AND substr(created_at, 1, 10) = ?`,
    date,
  )!;
  const byMethod = all<{ method: string; total: number }>(
    db,
    `SELECT p.method, SUM(p.amount_kurus) AS total FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id
      WHERE s.status = 'tamamlandi' AND substr(s.created_at, 1, 10) = ? GROUP BY p.method`,
    date,
  );
  const topProducts = all<{ product_name: string; qty: number; total: number }>(
    db,
    `SELECT i.product_name, SUM(i.qty) AS qty, SUM(i.line_total_kurus) AS total
       FROM pos_sale_items i JOIN pos_sales s ON s.id = i.sale_id
      WHERE s.status = 'tamamlandi' AND substr(s.created_at, 1, 10) = ?
      GROUP BY i.product_id ORDER BY total DESC LIMIT 10`,
    date,
  );
  const refunds = one<{ count: number; total: number | null }>(
    db,
    `SELECT COUNT(*) AS count, SUM(total_kurus) AS total FROM pos_sales WHERE status = 'iade' AND substr(created_at, 1, 10) = ?`,
    date,
  )!;
  const lowStock = all<{ id: string; name: string; qty: number }>(
    db,
    `SELECT p.id, p.name, b.qty FROM products p JOIN inventory_balances b ON b.product_id = p.id
      WHERE p.active = 1 AND p.track_stock = 1 AND b.qty <= 5000 ORDER BY b.qty LIMIT 20`,
  );
  return {
    date,
    sale_count: totals.count,
    total_kurus: totals.total ?? 0,
    vat_kurus: totals.vat ?? 0,
    discount_kurus: totals.discount ?? 0,
    by_method: Object.fromEntries(byMethod.map((r) => [r.method, r.total])),
    refunds: { count: refunds.count, total_kurus: refunds.total ?? 0 },
    top_products: topProducts,
    low_stock: lowStock,
  };
}

/** Yıllık rapor: ay ay etkinlik, sözleşme tutarı, tahsilat, kantin ve gider; etkinlik türü ve salon dağılımı. */
export function yearlyReport(db: DB, year: string) {
  if (!/^\d{4}$/.test(year)) throw new Error('Geçersiz yıl');
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const byMonth = (rows: Array<{ m: string; v: number }>) => {
    const map = Object.fromEntries(rows.map((r) => [r.m, r.v]));
    return months.map((m) => map[m] ?? 0);
  };
  const ITEMS = '(SELECT COALESCE(SUM(i.total_kurus), 0) FROM reservation_items i WHERE i.reservation_id = r.id)';
  const events = byMonth(all(db, `SELECT substr(event_date,1,7) AS m, COUNT(*) AS v FROM reservations r WHERE status IN ('kesin','tamamlandi') AND substr(event_date,1,4) = ? GROUP BY m`, year));
  const contract = byMonth(all(db, `SELECT substr(event_date,1,7) AS m, SUM(r.price_kurus - r.discount_kurus + ${ITEMS}) AS v FROM reservations r WHERE status IN ('kesin','tamamlandi') AND substr(event_date,1,4) = ? GROUP BY m`, year));
  const collected = byMonth(all(db, `SELECT substr(created_at,1,7) AS m, SUM(CASE kind WHEN 'iade' THEN -amount_kurus ELSE amount_kurus END) AS v FROM reservation_payments WHERE cancelled_at IS NULL AND substr(created_at,1,4) = ? GROUP BY m`, year));
  const pos = byMonth(all(db, `SELECT substr(created_at,1,7) AS m, SUM(total_kurus) AS v FROM pos_sales WHERE status = 'tamamlandi' AND substr(created_at,1,4) = ? GROUP BY m`, year));
  const otherIncome = byMonth(all(db, `SELECT substr(entry_date,1,7) AS m, SUM(amount_kurus) AS v FROM finance_entries WHERE type = 'gelir' AND deleted_at IS NULL AND substr(entry_date,1,4) = ? GROUP BY m`, year));
  const expense = byMonth(all(db, `SELECT substr(entry_date,1,7) AS m, SUM(amount_kurus) AS v FROM finance_entries WHERE type = 'gider' AND deleted_at IS NULL AND substr(entry_date,1,4) = ? GROUP BY m`, year));
  const wages = byMonth(all(db, `SELECT substr(r.event_date,1,7) AS m, SUM(es.wage_kurus) AS v FROM event_staff es JOIN reservations r ON r.id = es.reservation_id WHERE es.deleted_at IS NULL AND r.status != 'iptal' AND substr(r.event_date,1,4) = ? GROUP BY m`, year));
  const byType = all<{ event_type: string; count: number; total: number }>(db, `SELECT event_type, COUNT(*) AS count, SUM(r.price_kurus - r.discount_kurus + ${ITEMS}) AS total FROM reservations r WHERE status IN ('kesin','tamamlandi') AND substr(event_date,1,4) = ? GROUP BY event_type ORDER BY count DESC`, year);
  const byHall = all<{ hall_name: string; count: number; total: number }>(db, `SELECT h.name AS hall_name, COUNT(*) AS count, SUM(r.price_kurus - r.discount_kurus + ${ITEMS}) AS total FROM reservations r JOIN halls h ON h.id = r.hall_id WHERE r.status IN ('kesin','tamamlandi') AND substr(r.event_date,1,4) = ? GROUP BY h.id ORDER BY count DESC`, year);
  const byWeekday = all<{ wd: string; count: number }>(db, `SELECT strftime('%w', event_date) AS wd, COUNT(*) AS count FROM reservations WHERE status IN ('kesin','tamamlandi') AND substr(event_date,1,4) = ? GROUP BY wd`, year);
  const cancelled = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'iptal' AND substr(event_date,1,4) = ?", year)!.n;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const expenseTotal = months.map((_, i) => expense[i]! + wages[i]!);
  return {
    year,
    months,
    series: { events, contract, collected, pos, other_income: otherIncome, expense: expenseTotal },
    totals: {
      events: sum(events),
      contract_kurus: sum(contract),
      collected_kurus: sum(collected),
      pos_kurus: sum(pos),
      other_income_kurus: sum(otherIncome),
      expense_kurus: sum(expenseTotal),
      net_kurus: sum(collected) + sum(pos) + sum(otherIncome) - sum(expenseTotal),
      cancelled,
    },
    by_type: byType,
    by_hall: byHall,
    by_weekday: byWeekday,
  };
}
