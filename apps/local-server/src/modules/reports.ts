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
