/**
 * Yıllık rapor sorguları. Salondaki SQLite ile buluttaki D1 aynı tablo yapısını kullandığından
 * sorgular ortaktır; çalıştırıcı (senkron node:sqlite ya da asenkron D1) dışarıdan verilir.
 */
export type ReportQuery = <T = Record<string, unknown>>(sql: string, ...params: (string | number)[]) => Promise<T[]>;

const ITEMS = '(SELECT COALESCE(SUM(i.total_kurus), 0) FROM reservation_items i WHERE i.reservation_id = r.id)';
const PAID =
  "(SELECT COALESCE(SUM(CASE p.kind WHEN 'iade' THEN -p.amount_kurus ELSE p.amount_kurus END), 0) FROM reservation_payments p WHERE p.reservation_id = r.id AND p.cancelled_at IS NULL)";
const CONTRACT = `(r.price_kurus - r.discount_kurus + ${ITEMS})`;
const BOOKED = "r.status IN ('kesin','tamamlandi')";

export async function buildYearlyReport(q: ReportQuery, year: string) {
  if (!/^\d{4}$/.test(year)) throw new Error('Geçersiz yıl');
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const byMonth = async (sql: string) => {
    const rows = await q<{ m: string; v: number }>(sql, year);
    const map = Object.fromEntries(rows.map((r) => [r.m, Number(r.v ?? 0)]));
    return months.map((m) => map[m] ?? 0);
  };
  const [events, contract, collected, pos, otherIncome, expense, wages] = await Promise.all([
    byMonth(`SELECT substr(event_date,1,7) AS m, COUNT(*) AS v FROM reservations r WHERE ${BOOKED} AND substr(event_date,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(event_date,1,7) AS m, SUM(${CONTRACT}) AS v FROM reservations r WHERE ${BOOKED} AND substr(event_date,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(created_at,1,7) AS m, SUM(CASE kind WHEN 'iade' THEN -amount_kurus ELSE amount_kurus END) AS v FROM reservation_payments WHERE cancelled_at IS NULL AND substr(created_at,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(created_at,1,7) AS m, SUM(total_kurus) AS v FROM pos_sales WHERE status = 'tamamlandi' AND substr(created_at,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(entry_date,1,7) AS m, SUM(amount_kurus) AS v FROM finance_entries WHERE type = 'gelir' AND deleted_at IS NULL AND substr(entry_date,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(entry_date,1,7) AS m, SUM(amount_kurus) AS v FROM finance_entries WHERE type = 'gider' AND deleted_at IS NULL AND substr(entry_date,1,4) = ? GROUP BY m`),
    byMonth(`SELECT substr(r.event_date,1,7) AS m, SUM(es.wage_kurus) AS v FROM event_staff es JOIN reservations r ON r.id = es.reservation_id WHERE es.deleted_at IS NULL AND r.status != 'iptal' AND substr(r.event_date,1,4) = ? GROUP BY m`),
  ]);
  const [byType, byHall, byWeekday, cancelledRows] = await Promise.all([
    q<{ event_type: string; count: number; total: number }>(
      `SELECT event_type, COUNT(*) AS count, SUM(${CONTRACT}) AS total FROM reservations r WHERE ${BOOKED} AND substr(event_date,1,4) = ? GROUP BY event_type ORDER BY count DESC`, year),
    q<{ hall_name: string; count: number; total: number; collected: number; guests: number }>(
      `SELECT h.name AS hall_name, COUNT(*) AS count, SUM(${CONTRACT}) AS total, SUM(${PAID}) AS collected,
              COALESCE(SUM(r.guest_count), 0) AS guests
         FROM reservations r JOIN halls h ON h.id = r.hall_id
        WHERE ${BOOKED} AND substr(r.event_date,1,4) = ? GROUP BY h.id ORDER BY count DESC`, year),
    q<{ wd: string; count: number }>(
      `SELECT strftime('%w', event_date) AS wd, COUNT(*) AS count FROM reservations r WHERE ${BOOKED} AND substr(event_date,1,4) = ? GROUP BY wd`, year),
    q<{ n: number }>("SELECT COUNT(*) AS n FROM reservations WHERE status = 'iptal' AND substr(event_date,1,4) = ?", year),
  ]);
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
      cancelled: Number(cancelledRows[0]?.n ?? 0),
    },
    by_type: byType,
    by_hall: byHall.map((h) => ({ ...h, remaining: Number(h.total) - Number(h.collected) })),
    by_weekday: byWeekday,
  };
}
