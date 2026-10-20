import { newId, nowIso, NotFoundError, optionalString, requireString } from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue, publishRow } from '../database/outbox.ts';
import { listReservations } from './reservations.ts';

export interface CustomerSummary {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  national_id: string | null;
  notes: string | null;
  created_at: string;
  event_count: number;
  next_event: string | null;
  last_event: string | null;
}

export function listCustomers(db: DB, q?: string): CustomerSummary[] {
  const today = new Date().toISOString().slice(0, 10);
  const where = q ? 'WHERE c.full_name LIKE ? OR c.phone LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  return all<CustomerSummary>(
    db,
    `SELECT c.*,
            (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status != 'iptal') AS event_count,
            (SELECT MIN(event_date) FROM reservations r WHERE r.customer_id = c.id AND r.status IN ('opsiyon','kesin','talep') AND r.event_date >= '${today}') AS next_event,
            (SELECT MAX(event_date) FROM reservations r WHERE r.customer_id = c.id AND r.status != 'iptal') AS last_event
       FROM customers c ${where}
      ORDER BY c.updated_at DESC LIMIT 500`,
    ...params,
  ).sort((a, b) => (b.next_event ?? '').localeCompare(a.next_event ?? '') || a.full_name.localeCompare(b.full_name, 'tr'));
}

export function getCustomer(db: DB, id: string) {
  const c = one<Record<string, unknown>>(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw new NotFoundError('Müşteri bulunamadı');
  const reservations = listReservations(db, { customer_id: id });
  const notes = all(
    db,
    `SELECT n.*, u.full_name AS user_name FROM customer_notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.customer_id = ? ORDER BY n.created_at DESC`,
    id,
  );
  const messages = all(db, 'SELECT * FROM message_log WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50', id);
  const totals = reservations
    .filter((r) => r.status !== 'iptal')
    .reduce((s, r) => ({ total: s.total + r.total_kurus, paid: s.paid + r.paid_kurus }), { total: 0, paid: 0 });
  return { ...c, general_note: c.notes ?? null, reservations, notes, messages, total_kurus: totals.total, paid_kurus: totals.paid, balance_kurus: totals.total - totals.paid };
}

export function updateCustomer(
  db: DB,
  id: string,
  input: { full_name: string; phone?: string | null; email?: string | null; address?: string | null; national_id?: string | null; notes?: string | null },
  userId: string | null,
) {
  tx(db, () => {
    const res = run(
      db,
      'UPDATE customers SET full_name = ?, phone = ?, email = ?, address = ?, national_id = ?, notes = ?, updated_at = ? WHERE id = ?',
      requireString(input.full_name, 'Ad soyad', 120),
      optionalString(input.phone, 'Telefon', 30),
      optionalString(input.email, 'E-posta', 120),
      optionalString(input.address, 'Adres', 300),
      optionalString(input.national_id, 'T.C. kimlik no', 11),
      optionalString(input.notes, 'Notlar', 2000),
      nowIso(),
      id,
    );
    if (res.changes === 0) throw new NotFoundError('Müşteri bulunamadı');
    enqueue(db, 'customer.upserted', id, one(db, 'SELECT * FROM customers WHERE id = ?', id));
    audit(db, userId, 'customer.update', 'customer', id);
  });
  return getCustomer(db, id);
}

export function addNote(db: DB, input: { customer_id: string; reservation_id?: string | null; note: string }, userId: string | null) {
  const note = requireString(input.note, 'Not', 2000);
  return tx(db, () => {
    if (!one(db, 'SELECT id FROM customers WHERE id = ?', input.customer_id)) throw new NotFoundError('Müşteri bulunamadı');
    const now = nowIso();
    const id = newId();
    run(db, 'INSERT INTO customer_notes (id, customer_id, reservation_id, note, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, input.customer_id, input.reservation_id ?? null, note, userId, now, now);
    publishRow(db, 'customer_notes', id);
    return id;
  });
}
