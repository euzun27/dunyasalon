import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ValidationError } from '@dunyatek/shared';
import { one, run, tx, type DB } from '../database/db.ts';
import { audit } from '../database/outbox.ts';
import { AuthError, verifyPassword } from './auth.ts';

/**
 * Test verilerini temizler: rezervasyon, müşteri, tahsilat, kantin satışı, gelir-gider, stok.
 * Kullanıcılar, ayarlar, salonlar, ürünler (stok sıfırlanır), hizmetler, personel ve
 * mesaj şablonları korunur. Silme sırası: önce bağlı kayıtlar, sonra ana kayıtlar.
 */
export const RESET_TABLES = [
  'pos_payments', 'pos_sale_items', 'event_ledger', 'pos_sales', 'cash_sessions',
  'event_staff', 'reservation_items', 'reservation_payments', 'reservation_installments',
  'customer_notes', 'message_log', 'finance_entries', 'event_accounts', 'reservations', 'customers',
  'stock_movements', 'inventory_balances', 'sync_outbox',
] as const;

export const RESET_CONFIRM_WORD = 'SIFIRLA';

export async function resetTestData(
  db: DB,
  input: { password?: string; confirm?: string },
  user: { id: string },
  dbPath: string,
) {
  const row = one<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!row || !verifyPassword(String(input.password ?? ''), row.password_hash)) throw new AuthError('Şifre hatalı', 403);
  if (String(input.confirm ?? '').trim().toLocaleUpperCase('tr') !== RESET_CONFIRM_WORD) {
    throw new ValidationError(`Onay için ${RESET_CONFIRM_WORD} yazın`);
  }

  const dir = resolve(process.env.BACKUP_DIR ?? join(dirname(dbPath), 'backups'));
  mkdirSync(dir, { recursive: true });
  const backupFile = join(dir, `wedding-sifirlama-oncesi-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await backup(db, backupFile);

  const deleted = tx(db, () => {
    const counts: Record<string, number> = {};
    for (const t of RESET_TABLES) counts[t] = Number(run(db, `DELETE FROM ${t}`).changes);
    audit(db, user.id, 'data.reset', 'database', 'local', { backup: backupFile });
    return counts;
  });
  return { backup: backupFile, deleted };
}
