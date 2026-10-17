import { itemTotal, reservationMoney } from '@dunyatek/business-rules';
import {
  newId,
  nowIso,
  ConflictError,
  NotFoundError,
  ValidationError,
  optionalString,
  requireDate,
  requireInt,
  requireString,
} from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, publishRow } from '../database/outbox.ts';
import { getReservation, type ReservationView } from './reservations.ts';

export interface ItemRow {
  id: string;
  reservation_id: string;
  service_id: string | null;
  name: string;
  pricing: 'sabit' | 'kisi_basi';
  qty: number;
  unit_price_kurus: number;
  total_kurus: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  reservation_id: string;
  receipt_no: number;
  kind: 'kapora' | 'ara_odeme' | 'kalan' | 'iade';
  method: 'nakit' | 'kart' | 'havale';
  amount_kurus: number;
  note: string | null;
  user_id: string | null;
  user_name?: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface InstallmentRow {
  id: string;
  reservation_id: string;
  due_date: string;
  amount_kurus: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EventStaffRow {
  id: string;
  reservation_id: string;
  staff_id: string;
  staff_name: string;
  staff_phone: string | null;
  staff_title: string | null;
  task: string | null;
  wage_kurus: number;
}

function requireReservation(db: DB, id: string) {
  const r = one<{ id: string; guest_count: number | null; status: string }>(db, 'SELECT id, guest_count, status FROM reservations WHERE id = ?', id);
  if (!r) throw new NotFoundError('Rezervasyon bulunamadı');
  return r;
}

function touchReservation(db: DB, id: string) {
  // Toplamlar değişti: rezervasyonun sürümü artar, eşzamanlı form kaydı çakışmayı fark eder.
  run(db, 'UPDATE reservations SET version = version + 1, updated_at = ? WHERE id = ?', nowIso(), id);
}

// --- Menü / hizmet kalemleri ---

export function addItem(
  db: DB,
  reservationId: string,
  input: { service_id?: string | null; name?: string; pricing?: 'sabit' | 'kisi_basi'; qty?: number; unit_price_kurus?: number; note?: string | null },
  userId: string | null,
): ItemRow {
  return tx(db, () => {
    const r = requireReservation(db, reservationId);
    const svc = input.service_id
      ? one<{ id: string; name: string; pricing: 'sabit' | 'kisi_basi'; price_kurus: number }>(
          db, 'SELECT id, name, pricing, price_kurus FROM services WHERE id = ?', input.service_id)
      : null;
    if (input.service_id && !svc) throw new NotFoundError('Hizmet bulunamadı');
    const pricing = input.pricing ?? svc?.pricing ?? 'sabit';
    if (!['sabit', 'kisi_basi'].includes(pricing)) throw new ValidationError('Geçersiz fiyatlandırma');
    const qty = input.qty ?? (pricing === 'kisi_basi' ? r.guest_count ?? 0 : 1);
    if (!qty) throw new ValidationError('Kişi başı kalem için davetli sayısı ya da miktar girin');
    const unit = input.unit_price_kurus ?? svc?.price_kurus;
    const name = input.name ? requireString(input.name, 'Ad', 120) : svc?.name;
    if (!name || unit === undefined) throw new ValidationError('Hizmet seçin ya da ad ve fiyat girin');
    const now = nowIso();
    const row: ItemRow = {
      id: newId(),
      reservation_id: reservationId,
      service_id: svc?.id ?? null,
      name,
      pricing,
      qty: requireInt(qty, 'Miktar', { min: 1 }),
      unit_price_kurus: requireInt(unit, 'Birim fiyat', { min: 0 }),
      total_kurus: itemTotal(pricing, qty, unit),
      note: optionalString(input.note, 'Not', 300),
      created_at: now,
      updated_at: now,
    };
    run(
      db,
      `INSERT INTO reservation_items (id, reservation_id, service_id, name, pricing, qty, unit_price_kurus, total_kurus, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.reservation_id, row.service_id, row.name, row.pricing, row.qty, row.unit_price_kurus, row.total_kurus, row.note, now, now,
    );
    touchReservation(db, reservationId);
    publishRow(db, 'reservation_items', row.id);
    audit(db, userId, 'reservation.item.add', 'reservation', reservationId, { name, total: row.total_kurus });
    return row;
  });
}

export function updateItemQty(db: DB, itemId: string, qty: number, userId: string | null): ItemRow {
  requireInt(qty, 'Miktar', { min: 1 });
  return tx(db, () => {
    const it = one<ItemRow>(db, 'SELECT * FROM reservation_items WHERE id = ?', itemId);
    if (!it) throw new NotFoundError('Kalem bulunamadı');
    run(db, 'UPDATE reservation_items SET qty = ?, total_kurus = ?, updated_at = ? WHERE id = ?',
      qty, itemTotal(it.pricing, qty, it.unit_price_kurus), nowIso(), itemId);
    touchReservation(db, it.reservation_id);
    publishRow(db, 'reservation_items', itemId);
    audit(db, userId, 'reservation.item.qty', 'reservation', it.reservation_id, { item: it.name, qty });
    return one<ItemRow>(db, 'SELECT * FROM reservation_items WHERE id = ?', itemId)!;
  });
}

export function removeItem(db: DB, itemId: string, userId: string | null): void {
  tx(db, () => {
    const it = one<ItemRow>(db, 'SELECT * FROM reservation_items WHERE id = ?', itemId);
    if (!it) throw new NotFoundError('Kalem bulunamadı');
    // Silmeyi bulutla eşitlemek için miktarı sıfırlamak yerine kalemi 0 tutarla işaretliyoruz.
    run(db, 'UPDATE reservation_items SET total_kurus = 0, unit_price_kurus = 0, note = ?, updated_at = ? WHERE id = ?',
      'silindi', nowIso(), itemId);
    publishRow(db, 'reservation_items', itemId);
    run(db, 'DELETE FROM reservation_items WHERE id = ?', itemId);
    touchReservation(db, it.reservation_id);
    audit(db, userId, 'reservation.item.remove', 'reservation', it.reservation_id, { name: it.name });
  });
}

// --- Tahsilatlar ---

const PAYMENT_KINDS = ['kapora', 'ara_odeme', 'kalan', 'iade'] as const;
const PAYMENT_METHODS = ['nakit', 'kart', 'havale'] as const;

export function addPayment(
  db: DB,
  reservationId: string,
  input: { kind: PaymentRow['kind']; method: PaymentRow['method']; amount_kurus: number; note?: string | null },
  userId: string | null,
): PaymentRow {
  if (!PAYMENT_KINDS.includes(input.kind)) throw new ValidationError('Geçersiz tahsilat türü');
  if (!PAYMENT_METHODS.includes(input.method)) throw new ValidationError('Geçersiz ödeme yöntemi');
  const amount = requireInt(input.amount_kurus, 'Tutar', { min: 1 });
  return tx(db, () => {
    const r = requireReservation(db, reservationId);
    if (r.status === 'iptal' && input.kind !== 'iade') throw new ConflictError('İptal edilmiş rezervasyona tahsilat girilemez');
    if (input.kind === 'iade') {
      const money = moneyOf(db, reservationId);
      if (amount > money.paid_kurus) throw new ValidationError('İade tutarı alınan ödemeden fazla olamaz');
    }
    const now = nowIso();
    const receiptNo = (one<{ n: number | null }>(db, 'SELECT MAX(receipt_no) AS n FROM reservation_payments')?.n ?? 0) + 1;
    const id = newId();
    run(
      db,
      `INSERT INTO reservation_payments (id, reservation_id, receipt_no, kind, method, amount_kurus, note, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, reservationId, receiptNo, input.kind, input.method, amount, optionalString(input.note, 'Not', 300), userId, now, now,
    );
    publishRow(db, 'reservation_payments', id);
    audit(db, userId, 'reservation.payment', 'reservation', reservationId, { receiptNo, kind: input.kind, amount });
    return one<PaymentRow>(db, 'SELECT * FROM reservation_payments WHERE id = ?', id)!;
  });
}

/** Hatalı tahsilat silinmez, gerekçesiyle iptal edilir (denetim izi korunur). */
export function cancelPayment(db: DB, paymentId: string, reason: string, userId: string | null): PaymentRow {
  const why = requireString(reason, 'İptal gerekçesi', 300);
  return tx(db, () => {
    const p = one<PaymentRow>(db, 'SELECT * FROM reservation_payments WHERE id = ?', paymentId);
    if (!p) throw new NotFoundError('Tahsilat bulunamadı');
    if (p.cancelled_at) throw new ConflictError('Bu tahsilat zaten iptal edilmiş');
    const now = nowIso();
    run(db, 'UPDATE reservation_payments SET cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?', now, why, now, paymentId);
    publishRow(db, 'reservation_payments', paymentId);
    audit(db, userId, 'reservation.payment.cancel', 'reservation', p.reservation_id, { receipt: p.receipt_no, why });
    return one<PaymentRow>(db, 'SELECT * FROM reservation_payments WHERE id = ?', paymentId)!;
  });
}

export function getPayment(db: DB, id: string) {
  const p = one<PaymentRow>(db, 'SELECT p.*, u.full_name AS user_name FROM reservation_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', id);
  if (!p) throw new NotFoundError('Tahsilat bulunamadı');
  return { payment: p, reservation: getReservation(db, p.reservation_id) };
}

// --- Ödeme planı ---

export function addInstallment(db: DB, reservationId: string, input: { due_date: string; amount_kurus: number; note?: string | null }, userId: string | null) {
  const due = requireDate(input.due_date, 'Vade tarihi');
  const amount = requireInt(input.amount_kurus, 'Tutar', { min: 1 });
  return tx(db, () => {
    requireReservation(db, reservationId);
    const now = nowIso();
    const id = newId();
    run(db, 'INSERT INTO reservation_installments (id, reservation_id, due_date, amount_kurus, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, reservationId, due, amount, optionalString(input.note, 'Not', 200), now, now);
    publishRow(db, 'reservation_installments', id);
    audit(db, userId, 'reservation.installment.add', 'reservation', reservationId, { due, amount });
    return one<InstallmentRow>(db, 'SELECT * FROM reservation_installments WHERE id = ?', id)!;
  });
}

export function removeInstallment(db: DB, id: string, userId: string | null) {
  tx(db, () => {
    const now = nowIso();
    const res = run(db, 'UPDATE reservation_installments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, id);
    if (res.changes === 0) throw new NotFoundError('Vade bulunamadı');
    publishRow(db, 'reservation_installments', id);
    audit(db, userId, 'reservation.installment.remove', 'installment', id);
  });
}

// --- Personel ataması ---

export function assignStaff(db: DB, reservationId: string, input: { staff_id: string; task?: string | null; wage_kurus?: number }, userId: string | null) {
  return tx(db, () => {
    requireReservation(db, reservationId);
    const st = one<{ id: string; daily_wage_kurus: number }>(db, 'SELECT id, daily_wage_kurus FROM staff WHERE id = ? AND active = 1', input.staff_id);
    if (!st) throw new NotFoundError('Personel bulunamadı');
    const wage = input.wage_kurus === undefined ? st.daily_wage_kurus : requireInt(input.wage_kurus, 'Yevmiye', { min: 0 });
    const task = optionalString(input.task, 'Görev', 100);
    const now = nowIso();
    const existing = one<{ id: string }>(db, 'SELECT id FROM event_staff WHERE reservation_id = ? AND staff_id = ?', reservationId, st.id);
    let id = existing?.id;
    if (id) {
      run(db, 'UPDATE event_staff SET task = ?, wage_kurus = ?, deleted_at = NULL, updated_at = ? WHERE id = ?', task, wage, now, id);
    } else {
      id = newId();
      run(db, 'INSERT INTO event_staff (id, reservation_id, staff_id, task, wage_kurus, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, reservationId, st.id, task, wage, now, now);
    }
    publishRow(db, 'event_staff', id);
    audit(db, userId, 'reservation.staff.assign', 'reservation', reservationId, { staff: st.id });
    return id;
  });
}

export function unassignStaff(db: DB, eventStaffId: string, userId: string | null) {
  tx(db, () => {
    const now = nowIso();
    const res = run(db, 'UPDATE event_staff SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, eventStaffId);
    if (res.changes === 0) throw new NotFoundError('Atama bulunamadı');
    publishRow(db, 'event_staff', eventStaffId);
    audit(db, userId, 'reservation.staff.unassign', 'event_staff', eventStaffId);
  });
}

// --- Toplu görünüm ---

function moneyOf(db: DB, reservationId: string) {
  const r = one<{ price_kurus: number; discount_kurus: number }>(db, 'SELECT price_kurus, discount_kurus FROM reservations WHERE id = ?', reservationId)!;
  return reservationMoney({
    ...r,
    items: all<{ total_kurus: number }>(db, 'SELECT total_kurus FROM reservation_items WHERE reservation_id = ?', reservationId),
    payments: all<{ kind: string; amount_kurus: number; cancelled_at: string | null }>(
      db, 'SELECT kind, amount_kurus, cancelled_at FROM reservation_payments WHERE reservation_id = ?', reservationId),
  });
}

export function reservationDetail(db: DB, id: string) {
  const reservation: ReservationView = getReservation(db, id);
  const customer = one<Record<string, unknown>>(db, 'SELECT * FROM customers WHERE id = ?', reservation.customer_id);
  const items = all<ItemRow>(db, 'SELECT * FROM reservation_items WHERE reservation_id = ? ORDER BY created_at', id);
  const payments = all<PaymentRow>(
    db,
    'SELECT p.*, u.full_name AS user_name FROM reservation_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.reservation_id = ? ORDER BY p.created_at',
    id,
  );
  const installments = all<InstallmentRow>(
    db, 'SELECT * FROM reservation_installments WHERE reservation_id = ? AND deleted_at IS NULL ORDER BY due_date', id);
  const staff = all<EventStaffRow>(
    db,
    `SELECT es.id, es.reservation_id, es.staff_id, s.full_name AS staff_name, s.phone AS staff_phone, s.title AS staff_title,
            es.task, es.wage_kurus
       FROM event_staff es JOIN staff s ON s.id = es.staff_id
      WHERE es.reservation_id = ? AND es.deleted_at IS NULL ORDER BY s.full_name`,
    id,
  );
  const notes = all<{ id: string; note: string; created_at: string; user_name: string | null }>(
    db,
    `SELECT n.id, n.note, n.created_at, u.full_name AS user_name FROM customer_notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.reservation_id = ? OR (n.customer_id = ? AND n.reservation_id IS NULL) ORDER BY n.created_at DESC`,
    id, reservation.customer_id,
  );
  const expenses = all<{ id: string; category: string; amount_kurus: number; description: string | null; entry_date: string }>(
    db,
    "SELECT id, category, amount_kurus, description, entry_date FROM finance_entries WHERE reservation_id = ? AND type = 'gider' AND deleted_at IS NULL ORDER BY entry_date",
    id,
  );
  const canteen = reservation.event_account_id
    ? one<{ balance_kurus: number }>(
        db,
        "SELECT COALESCE(SUM(CASE entry_type WHEN 'borc' THEN amount_kurus ELSE -amount_kurus END), 0) AS balance_kurus FROM event_ledger WHERE event_account_id = ?",
        reservation.event_account_id,
      )!.balance_kurus
    : 0;
  const money = moneyOf(db, id);
  const staffCost = staff.reduce((s, x) => s + x.wage_kurus, 0);
  const expenseCost = expenses.reduce((s, x) => s + x.amount_kurus, 0);
  const today = new Date().toISOString().slice(0, 10);
  // Vadesi gelmiş toplam plan − tahsil edilen = gecikmiş tutar
  const dueSoFar = installments.filter((i) => i.due_date <= today).reduce((s, i) => s + i.amount_kurus, 0);
  return {
    reservation,
    customer,
    items,
    payments,
    installments,
    staff,
    notes,
    expenses,
    money: {
      ...money,
      canteen_balance_kurus: canteen,
      staff_cost_kurus: staffCost,
      expense_cost_kurus: expenseCost,
      net_kurus: money.total_kurus - staffCost - expenseCost,
      overdue_kurus: Math.max(0, dueSoFar - money.paid_kurus),
      planned_kurus: installments.reduce((s, i) => s + i.amount_kurus, 0),
    },
  };
}
