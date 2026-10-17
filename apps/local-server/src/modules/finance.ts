import { newId, nowIso, NotFoundError, ValidationError, optionalString, requireDate, requireInt, requireString } from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, publishRow } from '../database/outbox.ts';

export const EXPENSE_CATEGORIES = ['Personel', 'Mutfak / gıda', 'Kira', 'Elektrik / su / doğalgaz', 'Temizlik', 'Bakım / onarım', 'Süsleme / çiçek', 'Müzik / orkestra', 'Reklam', 'Vergi / SGK', 'Kantin alımı', 'Diğer'];
export const INCOME_CATEGORIES = ['Ek hizmet', 'Fotoğraf / video', 'Kiralama', 'Diğer'];

export interface FinanceEntry {
  id: string;
  type: 'gelir' | 'gider';
  category: string;
  amount_kurus: number;
  method: 'nakit' | 'kart' | 'havale';
  description: string | null;
  reservation_id: string | null;
  entry_date: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function listEntries(db: DB, from: string, to: string): Array<FinanceEntry & { customer_name: string | null }> {
  return all(
    db,
    `SELECT f.*, c.full_name AS customer_name FROM finance_entries f
       LEFT JOIN reservations r ON r.id = f.reservation_id LEFT JOIN customers c ON c.id = r.customer_id
      WHERE f.deleted_at IS NULL AND f.entry_date BETWEEN ? AND ? ORDER BY f.entry_date DESC, f.created_at DESC`,
    requireDate(from, 'Başlangıç'),
    requireDate(to, 'Bitiş'),
  );
}

export function addEntry(
  db: DB,
  input: { type: 'gelir' | 'gider'; category: string; amount_kurus: number; method?: FinanceEntry['method']; description?: string | null; reservation_id?: string | null; entry_date: string },
  userId: string | null,
): FinanceEntry {
  if (!['gelir', 'gider'].includes(input.type)) throw new ValidationError('Geçersiz kayıt türü');
  const method = input.method ?? 'nakit';
  if (!['nakit', 'kart', 'havale'].includes(method)) throw new ValidationError('Geçersiz ödeme yöntemi');
  const row = {
    id: newId(),
    category: requireString(input.category, 'Kategori', 60),
    amount: requireInt(input.amount_kurus, 'Tutar', { min: 1 }),
    description: optionalString(input.description, 'Açıklama', 300),
    date: requireDate(input.entry_date, 'Tarih'),
  };
  return tx(db, () => {
    if (input.reservation_id && !one(db, 'SELECT id FROM reservations WHERE id = ?', input.reservation_id)) {
      throw new NotFoundError('Rezervasyon bulunamadı');
    }
    const now = nowIso();
    run(
      db,
      `INSERT INTO finance_entries (id, type, category, amount_kurus, method, description, reservation_id, entry_date, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, input.type, row.category, row.amount, method, row.description, input.reservation_id ?? null, row.date, userId, now, now,
    );
    publishRow(db, 'finance_entries', row.id);
    audit(db, userId, `finance.${input.type}`, 'finance_entry', row.id, { amount: row.amount });
    return one<FinanceEntry>(db, 'SELECT * FROM finance_entries WHERE id = ?', row.id)!;
  });
}

export function deleteEntry(db: DB, id: string, userId: string | null) {
  tx(db, () => {
    const now = nowIso();
    const res = run(db, 'UPDATE finance_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, id);
    if (res.changes === 0) throw new NotFoundError('Kayıt bulunamadı');
    publishRow(db, 'finance_entries', id);
    audit(db, userId, 'finance.delete', 'finance_entry', id);
  });
}

/**
 * Dönem özeti: rezervasyon tahsilatları + kantin satışları + diğer gelirler,
 * diğer giderler + personel yevmiyeleri (o dönemdeki etkinlikler).
 */
export function financeSummary(db: DB, from: string, to: string) {
  requireDate(from, 'Başlangıç');
  requireDate(to, 'Bitiş');
  const toEnd = `${to}T23:59:59.999Z`;
  const resPay = all<{ method: string; total: number }>(
    db,
    `SELECT method, SUM(CASE kind WHEN 'iade' THEN -amount_kurus ELSE amount_kurus END) AS total
       FROM reservation_payments WHERE cancelled_at IS NULL AND created_at BETWEEN ? AND ? GROUP BY method`,
    from, toEnd,
  );
  const pos = one<{ total: number | null }>(
    db, "SELECT SUM(total_kurus) AS total FROM pos_sales WHERE status = 'tamamlandi' AND created_at BETWEEN ? AND ?", from, toEnd)!;
  const posCash = all<{ method: string; total: number }>(
    db,
    `SELECT p.method, SUM(p.amount_kurus) AS total FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id
      WHERE s.status = 'tamamlandi' AND s.created_at BETWEEN ? AND ? GROUP BY p.method`,
    from, toEnd,
  );
  const byCat = all<{ type: string; category: string; total: number }>(
    db,
    `SELECT type, category, SUM(amount_kurus) AS total FROM finance_entries
      WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ? GROUP BY type, category ORDER BY total DESC`,
    from, to,
  );
  const wages = one<{ total: number | null }>(
    db,
    `SELECT SUM(es.wage_kurus) AS total FROM event_staff es JOIN reservations r ON r.id = es.reservation_id
      WHERE es.deleted_at IS NULL AND r.status != 'iptal' AND r.event_date BETWEEN ? AND ?`,
    from, to,
  )!;
  const reservationIncome = resPay.reduce((s, r) => s + r.total, 0);
  const otherIncome = byCat.filter((c) => c.type === 'gelir').reduce((s, c) => s + c.total, 0);
  const otherExpense = byCat.filter((c) => c.type === 'gider').reduce((s, c) => s + c.total, 0);
  const posTotal = pos.total ?? 0;
  const income = reservationIncome + posTotal + otherIncome;
  const expense = otherExpense + (wages.total ?? 0);
  return {
    from,
    to,
    income_kurus: income,
    expense_kurus: expense,
    net_kurus: income - expense,
    reservation_income_kurus: reservationIncome,
    reservation_by_method: Object.fromEntries(resPay.map((r) => [r.method, r.total])),
    pos_income_kurus: posTotal,
    pos_by_method: Object.fromEntries(posCash.map((r) => [r.method, r.total])),
    other_income_kurus: otherIncome,
    staff_wages_kurus: wages.total ?? 0,
    other_expense_kurus: otherExpense,
    by_category: byCat,
  };
}
