import { findConflicts, neighbourDates, BLOCKING_STATUSES } from '@dunyatek/business-rules';
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
  requireTime,
  type ReservationInput,
  type ReservationStatus,
} from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue } from '../database/outbox.ts';
import { insertEventAccount } from './event-accounts.ts';

const STATUSES: ReservationStatus[] = ['talep', 'opsiyon', 'kesin', 'iptal', 'tamamlandi'];

export interface HallRow {
  id: string;
  name: string;
  capacity: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ReservationRow {
  id: string;
  hall_id: string;
  customer_id: string;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  guest_count: number | null;
  price_kurus: number;
  deposit_kurus: number;
  status: ReservationStatus;
  notes: string | null;
  option_until: string | null;
  discount_kurus: number;
  source: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReservationView = ReservationRow & {
  hall_name: string;
  customer_name: string;
  customer_phone: string | null;
  event_account_id: string | null;
  total_kurus: number;
  paid_kurus: number;
  balance_kurus: number;
};

const ITEMS_SUM = '(SELECT COALESCE(SUM(i.total_kurus), 0) FROM reservation_items i WHERE i.reservation_id = r.id)';
const PAID_SUM = `(SELECT COALESCE(SUM(CASE p.kind WHEN 'iade' THEN -p.amount_kurus ELSE p.amount_kurus END), 0)
                     FROM reservation_payments p WHERE p.reservation_id = r.id AND p.cancelled_at IS NULL)`;

const VIEW_SQL = `SELECT r.*, h.name AS hall_name, c.full_name AS customer_name, c.phone AS customer_phone,
                         a.id AS event_account_id,
                         r.price_kurus + ${ITEMS_SUM} - r.discount_kurus AS total_kurus,
                         ${PAID_SUM} AS paid_kurus,
                         r.price_kurus + ${ITEMS_SUM} - r.discount_kurus - ${PAID_SUM} AS balance_kurus
                    FROM reservations r
                    JOIN halls h ON h.id = r.hall_id
                    JOIN customers c ON c.id = r.customer_id
                    LEFT JOIN event_accounts a ON a.reservation_id = r.id`;

// --- Salonlar ---

export function listHalls(db: DB): HallRow[] {
  return all<HallRow>(db, 'SELECT * FROM halls ORDER BY name');
}

export function createHall(db: DB, input: { name: string; capacity?: number | null }, userId: string | null): HallRow {
  const name = requireString(input.name, 'Salon adı', 80);
  const capacity = input.capacity == null ? null : requireInt(input.capacity, 'Kapasite', { min: 1 });
  return tx(db, () => {
    if (one(db, 'SELECT id FROM halls WHERE name = ?', name)) throw new ConflictError('Bu isimde salon var');
    const now = nowIso();
    const row: HallRow = { id: newId(), name, capacity, active: 1, created_at: now, updated_at: now };
    run(db, 'INSERT INTO halls (id, name, capacity, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      row.id, row.name, row.capacity, row.active, row.created_at, row.updated_at);
    enqueue(db, 'hall.upserted', row.id, row);
    audit(db, userId, 'hall.create', 'hall', row.id);
    return row;
  });
}

// --- Rezervasyonlar ---

function normalize(input: ReservationInput) {
  const status = input.status ?? 'opsiyon';
  if (!STATUSES.includes(status)) throw new ValidationError('Geçersiz rezervasyon durumu');
  return {
    hall_id: requireString(input.hall_id, 'Salon', 64),
    customer_name: requireString(input.customer_name, 'Müşteri adı', 120),
    customer_phone: optionalString(input.customer_phone, 'Telefon', 30),
    event_type: optionalString(input.event_type, 'Etkinlik türü', 40) ?? 'dugun',
    event_date: requireDate(input.event_date, 'Tarih'),
    start_time: requireTime(input.start_time, 'Başlangıç saati'),
    end_time: requireTime(input.end_time, 'Bitiş saati'),
    guest_count: input.guest_count == null ? null : requireInt(input.guest_count, 'Davetli sayısı', { min: 0 }),
    price_kurus: requireInt(input.price_kurus ?? 0, 'Fiyat', { min: 0 }),
    deposit_kurus: requireInt(input.deposit_kurus ?? 0, 'Kapora', { min: 0 }),
    status,
    notes: optionalString(input.notes, 'Notlar', 2000),
    option_until: input.option_until ? requireDate(input.option_until, 'Opsiyon bitiş tarihi') : null,
    discount_kurus: requireInt(input.discount_kurus ?? 0, 'İndirim', { min: 0 }),
  };
}

/**
 * Çakışma kontrolü yerel sunucuda, yazma kilidi altında yapılır (BEGIN IMMEDIATE).
 * Böylece iki kullanıcı aynı salonu aynı saate aynı anda kesinleştiremez.
 */
function assertNoConflict(db: DB, r: { id?: string; hall_id: string; event_date: string; start_time: string; end_time: string; status: ReservationStatus }, bufferMinutes: number) {
  if (!BLOCKING_STATUSES.includes(r.status)) return;
  const dates = neighbourDates(r.event_date);
  const existing = all<ReservationView>(
    db,
    `${VIEW_SQL} WHERE r.hall_id = ? AND r.event_date IN (?, ?, ?)`,
    r.hall_id, dates[0]!, dates[1]!, dates[2]!,
  );
  const conflicts = findConflicts(r, existing, bufferMinutes);
  if (conflicts.length > 0) {
    const c = conflicts[0]!;
    throw new ConflictError(
      `Salon dolu: ${c.customer_name} (${c.event_date} ${c.start_time}-${c.end_time}, ${c.status})`,
    );
  }
}

function upsertCustomer(db: DB, name: string, phone: string | null): string {
  if (phone) {
    const existing = one<{ id: string; full_name: string }>(db, 'SELECT id, full_name FROM customers WHERE phone = ?', phone);
    if (existing) return existing.id;
  }
  const now = nowIso();
  const row = { id: newId(), full_name: name, phone, email: null, notes: null, created_at: now, updated_at: now };
  run(db, 'INSERT INTO customers (id, full_name, phone, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id, row.full_name, row.phone, row.email, row.notes, row.created_at, row.updated_at);
  enqueue(db, 'customer.upserted', row.id, row);
  return row.id;
}

function publish(db: DB, id: string) {
  enqueue(db, 'reservation.upserted', id, one<ReservationRow>(db, 'SELECT * FROM reservations WHERE id = ?', id));
}

export function getReservation(db: DB, id: string): ReservationView {
  const r = one<ReservationView>(db, `${VIEW_SQL} WHERE r.id = ?`, id);
  if (!r) throw new NotFoundError('Rezervasyon bulunamadı');
  return r;
}

export function listReservations(
  db: DB,
  opts: { from?: string; to?: string; hall_id?: string; customer_id?: string; status?: string } = {},
): ReservationView[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.from) { where.push('r.event_date >= ?'); params.push(requireDate(opts.from, 'Başlangıç')); }
  if (opts.to) { where.push('r.event_date <= ?'); params.push(requireDate(opts.to, 'Bitiş')); }
  if (opts.hall_id) { where.push('r.hall_id = ?'); params.push(opts.hall_id); }
  if (opts.customer_id) { where.push('r.customer_id = ?'); params.push(opts.customer_id); }
  if (opts.status) { where.push('r.status = ?'); params.push(opts.status); }
  return all<ReservationView>(
    db,
    `${VIEW_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.event_date, r.start_time LIMIT 1000`,
    ...params,
  );
}

export function createReservation(
  db: DB,
  input: ReservationInput,
  ctx: { userId: string | null; bufferMinutes: number; source?: string },
): ReservationView {
  const r = normalize(input);
  const id = input.id ?? newId();
  tx(db, () => {
    if (one(db, 'SELECT id FROM reservations WHERE id = ?', id)) throw new ConflictError('Rezervasyon zaten kayıtlı');
    if (!one(db, 'SELECT id FROM halls WHERE id = ? AND active = 1', r.hall_id)) throw new NotFoundError('Salon bulunamadı');
    assertNoConflict(db, { ...r, id }, ctx.bufferMinutes);
    const customerId = upsertCustomer(db, r.customer_name, r.customer_phone);
    const now = nowIso();
    run(
      db,
      `INSERT INTO reservations (id, hall_id, customer_id, event_type, event_date, start_time, end_time, guest_count,
                                 price_kurus, deposit_kurus, status, notes, option_until, discount_kurus, source, version,
                                 created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id, r.hall_id, customerId, r.event_type, r.event_date, r.start_time, r.end_time, r.guest_count,
      r.price_kurus, r.deposit_kurus, r.status, r.notes, r.option_until, r.discount_kurus, ctx.source ?? 'yerel', ctx.userId, now, now,
    );
    publish(db, id);
    if (r.status === 'kesin') ensureEventAccount(db, id, r.customer_name, r.event_date);
    audit(db, ctx.userId, 'reservation.create', 'reservation', id, { status: r.status, date: r.event_date });
  });
  return getReservation(db, id);
}

/** İyimser kilit: istemci okuduğu version'ı gönderir; arada değiştiyse 409 döner. */
export function updateReservation(
  db: DB,
  id: string,
  input: ReservationInput & { version: number },
  ctx: { userId: string | null; bufferMinutes: number },
): ReservationView {
  const r = normalize(input);
  tx(db, () => {
    const current = one<ReservationRow>(db, 'SELECT * FROM reservations WHERE id = ?', id);
    if (!current) throw new NotFoundError('Rezervasyon bulunamadı');
    if (current.version !== input.version) {
      throw new ConflictError('Rezervasyon başka bir kullanıcı tarafından değiştirildi; sayfayı yenileyin');
    }
    assertNoConflict(db, { ...r, id }, ctx.bufferMinutes);
    run(
      db,
      `UPDATE customers SET full_name = ?, phone = ?, updated_at = ? WHERE id = ?`,
      r.customer_name, r.customer_phone, nowIso(), current.customer_id,
    );
    enqueue(db, 'customer.upserted', current.customer_id, one(db, 'SELECT * FROM customers WHERE id = ?', current.customer_id));
    run(
      db,
      `UPDATE reservations SET hall_id = ?, event_type = ?, event_date = ?, start_time = ?, end_time = ?, guest_count = ?,
              price_kurus = ?, deposit_kurus = ?, status = ?, notes = ?, option_until = ?, discount_kurus = ?,
              version = version + 1, updated_at = ?
        WHERE id = ?`,
      r.hall_id, r.event_type, r.event_date, r.start_time, r.end_time, r.guest_count,
      r.price_kurus, r.deposit_kurus, r.status, r.notes, r.option_until, r.discount_kurus, nowIso(), id,
    );
    publish(db, id);
    if (r.status === 'kesin') ensureEventAccount(db, id, r.customer_name, r.event_date);
    audit(db, ctx.userId, 'reservation.update', 'reservation', id, { from: current.status, to: r.status });
  });
  return getReservation(db, id);
}

export function setReservationStatus(
  db: DB,
  id: string,
  status: ReservationStatus,
  ctx: { userId: string | null; bufferMinutes: number },
): ReservationView {
  if (!STATUSES.includes(status)) throw new ValidationError('Geçersiz rezervasyon durumu');
  tx(db, () => {
    const current = getReservation(db, id);
    assertNoConflict(db, { ...current, status }, ctx.bufferMinutes);
    run(db, 'UPDATE reservations SET status = ?, version = version + 1, updated_at = ? WHERE id = ?', status, nowIso(), id);
    publish(db, id);
    if (status === 'kesin') ensureEventAccount(db, id, current.customer_name, current.event_date);
    audit(db, ctx.userId, 'reservation.status', 'reservation', id, { from: current.status, to: status });
  });
  return getReservation(db, id);
}

/** Kesinleşen her düğün için kantin/ek hizmet cari hesabı açılır. */
function ensureEventAccount(db: DB, reservationId: string, customerName: string, date: string) {
  if (one(db, 'SELECT id FROM event_accounts WHERE reservation_id = ?', reservationId)) return;
  insertEventAccount(db, { reservation_id: reservationId, title: `${customerName} · ${date}` });
}

export function checkAvailability(
  db: DB,
  q: { hall_id: string; event_date: string; start_time: string; end_time: string; exclude_id?: string },
  bufferMinutes: number,
): { available: boolean; conflicts: ReservationView[] } {
  const slot = {
    id: q.exclude_id,
    event_date: requireDate(q.event_date, 'Tarih'),
    start_time: requireTime(q.start_time, 'Başlangıç saati'),
    end_time: requireTime(q.end_time, 'Bitiş saati'),
  };
  const dates = neighbourDates(slot.event_date);
  const existing = all<ReservationView>(db, `${VIEW_SQL} WHERE r.hall_id = ? AND r.event_date IN (?, ?, ?)`, q.hall_id, dates[0]!, dates[1]!, dates[2]!);
  const conflicts = findConflicts(slot, existing, bufferMinutes);
  return { available: conflicts.length === 0, conflicts };
}
