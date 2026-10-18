import { newId, nowIso, NotFoundError, ValidationError, ConflictError, optionalString, requireInt, requireString } from '@dunyatek/shared';
import { EVENT_ACCOUNT_BALANCE_SQL, EVENT_ACCOUNT_ORDER_SQL } from '@dunyatek/business-rules';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue } from '../database/outbox.ts';

export interface EventAccountRow {
  id: string;
  reservation_id: string | null;
  title: string;
  status: 'acik' | 'kapali';
  credit_limit_kurus: number | null;
  created_at: string;
  updated_at: string;
}

export interface LedgerRow {
  id: string;
  event_account_id: string;
  entry_type: 'borc' | 'alacak';
  amount_kurus: number;
  description: string;
  ref_type: string | null;
  ref_id: string | null;
  user_id: string | null;
  created_at: string;
}

const BALANCE_SQL = EVENT_ACCOUNT_BALANCE_SQL;

export type EventAccountSummary = EventAccountRow & {
  event_date: string | null;
  debit_kurus: number;
  credit_kurus: number;
  balance_kurus: number;
};

/** Çağıran transaction içinde kullanılır. */
export function postLedgerEntry(db: DB, e: Omit<LedgerRow, 'id'> & { id?: string }): LedgerRow {
  const row: LedgerRow = { ...e, id: e.id ?? newId() };
  run(
    db,
    `INSERT INTO event_ledger (id, event_account_id, entry_type, amount_kurus, description, ref_type, ref_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.event_account_id, row.entry_type, row.amount_kurus, row.description, row.ref_type, row.ref_id, row.user_id, row.created_at,
  );
  return row;
}

/** Çağıran transaction içinde kullanılır. */
export function insertEventAccount(
  db: DB,
  input: { title: string; reservation_id?: string | null; credit_limit_kurus?: number | null },
): EventAccountRow {
  const now = nowIso();
  const row: EventAccountRow = {
    id: newId(),
    reservation_id: input.reservation_id ?? null,
    title: requireString(input.title, 'Hesap adı', 120),
    status: 'acik',
    credit_limit_kurus:
      input.credit_limit_kurus === undefined || input.credit_limit_kurus === null
        ? null
        : requireInt(input.credit_limit_kurus, 'Limit', { min: 0 }),
    created_at: now,
    updated_at: now,
  };
  run(
    db,
    `INSERT INTO event_accounts (id, reservation_id, title, status, credit_limit_kurus, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.reservation_id, row.title, row.status, row.credit_limit_kurus, row.created_at, row.updated_at,
  );
  enqueue(db, 'event_account.upserted', row.id, row);
  return row;
}

export function createEventAccount(
  db: DB,
  input: { title: string; reservation_id?: string | null; credit_limit_kurus?: number | null },
  userId: string | null,
): EventAccountSummary {
  const id = tx(db, () => {
    if (input.reservation_id) {
      if (!one(db, 'SELECT id FROM reservations WHERE id = ?', input.reservation_id)) throw new NotFoundError('Rezervasyon bulunamadı');
      if (one(db, 'SELECT id FROM event_accounts WHERE reservation_id = ?', input.reservation_id)) {
        throw new ConflictError('Bu rezervasyonun hesabı zaten var');
      }
    }
    const row = insertEventAccount(db, input);
    audit(db, userId, 'event_account.create', 'event_account', row.id);
    return row.id;
  });
  return getEventAccount(db, id);
}

export function listEventAccounts(db: DB, opts: { status?: 'acik' | 'kapali' } = {}): EventAccountSummary[] {
  const where = opts.status ? 'WHERE a.status = ?' : '';
  const params = opts.status ? [opts.status] : [];
  return all<EventAccountSummary>(db, `${BALANCE_SQL} ${where} ${EVENT_ACCOUNT_ORDER_SQL}`, ...params);
}

export function getEventAccount(db: DB, id: string): EventAccountSummary {
  const a = one<EventAccountSummary>(db, `${BALANCE_SQL} WHERE a.id = ? GROUP BY a.id`, id);
  if (!a) throw new NotFoundError('Organizasyon hesabı bulunamadı');
  return a;
}

export function getLedger(db: DB, accountId: string): LedgerRow[] {
  return all<LedgerRow>(db, 'SELECT * FROM event_ledger WHERE event_account_id = ? ORDER BY created_at, rowid', accountId);
}

/** Elle borç/alacak (ör. ek hizmet borcu ya da müşteriden tahsilat). */
export function addManualEntry(
  db: DB,
  accountId: string,
  input: { entry_type: 'borc' | 'alacak'; amount_kurus: number; description: string },
  userId: string | null,
): LedgerRow {
  if (!['borc', 'alacak'].includes(input.entry_type)) throw new ValidationError('Geçersiz kayıt türü');
  const amount = requireInt(input.amount_kurus, 'Tutar', { min: 1 });
  const description = requireString(input.description, 'Açıklama', 200);
  return tx(db, () => {
    const acc = one<{ status: string }>(db, 'SELECT status FROM event_accounts WHERE id = ?', accountId);
    if (!acc) throw new NotFoundError('Organizasyon hesabı bulunamadı');
    if (acc.status !== 'acik') throw new ConflictError('Hesap kapalı');
    const row = postLedgerEntry(db, {
      event_account_id: accountId,
      entry_type: input.entry_type,
      amount_kurus: amount,
      description,
      ref_type: 'manuel',
      ref_id: null,
      user_id: userId,
      created_at: nowIso(),
    });
    enqueue(db, 'event_ledger.posted', row.id, row);
    audit(db, userId, `ledger.${input.entry_type}`, 'event_account', accountId, { amount });
    return row;
  });
}

export function setAccountStatus(db: DB, id: string, status: 'acik' | 'kapali', userId: string | null, note?: string) {
  optionalString(note, 'Not');
  tx(db, () => {
    const res = run(db, 'UPDATE event_accounts SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
    if (res.changes === 0) throw new NotFoundError('Organizasyon hesabı bulunamadı');
    enqueue(db, 'event_account.upserted', id, one(db, 'SELECT * FROM event_accounts WHERE id = ?', id));
    audit(db, userId, `event_account.${status}`, 'event_account', id);
  });
  return getEventAccount(db, id);
}
