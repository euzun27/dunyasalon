import { resolve } from 'node:path';
import { toQty } from '@dunyatek/shared';
import { openDatabase, type DB } from '../../apps/local-server/src/database/db.ts';
import { createUser } from '../../apps/local-server/src/modules/auth.ts';
import { createProduct } from '../../apps/local-server/src/modules/products.ts';
import { recordManualMovement } from '../../apps/local-server/src/modules/inventory.ts';
import { createHall } from '../../apps/local-server/src/modules/reservations.ts';

export const MIGRATIONS = resolve(import.meta.dirname, '../../migrations/local');

export function freshDb(): DB {
  return openDatabase(':memory:', MIGRATIONS);
}

export function seed(db: DB) {
  const admin = createUser(db, { username: 'admin', full_name: 'Yönetici', role: 'admin', password: 'admin123' });
  const kola = createProduct(db, { barcode: '8690000000001', name: 'Kola', category: 'İçecek', price_kurus: 4000, vat_rate: 10 }, admin.id);
  const su = createProduct(db, { barcode: '8690000000002', name: 'Su', category: 'İçecek', price_kurus: 1500, vat_rate: 10 }, admin.id);
  recordManualMovement(db, { product_id: kola.id, type: 'giris', qty: toQty(100) }, admin.id);
  recordManualMovement(db, { product_id: su.id, type: 'giris', qty: toQty(1) }, admin.id);
  const hall = createHall(db, { name: 'Büyük Salon', capacity: 500 }, admin.id);
  return { admin, kola, su, hall };
}

export function count(db: DB, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}
