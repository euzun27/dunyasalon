import {
  newId,
  nowIso,
  NotFoundError,
  ConflictError,
  optionalString,
  requireInt,
  requireString,
  type Product,
} from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue } from '../database/outbox.ts';

export interface ProductInput {
  barcode?: string | null;
  name: string;
  category?: string | null;
  unit?: string;
  price_kurus: number;
  vat_rate?: number;
  track_stock?: boolean;
  active?: boolean;
}

export type ProductWithStock = Product & { stock_qty: number };

const SELECT = `SELECT p.*, COALESCE(b.qty, 0) AS stock_qty
                  FROM products p LEFT JOIN inventory_balances b ON b.product_id = p.id`;

export function listProducts(db: DB, opts: { q?: string; includeInactive?: boolean } = {}): ProductWithStock[] {
  const where: string[] = [];
  const params: string[] = [];
  if (!opts.includeInactive) where.push('p.active = 1');
  if (opts.q) {
    where.push('(p.name LIKE ? OR p.barcode = ?)');
    params.push(`%${opts.q}%`, opts.q);
  }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT 500`;
  // SQLite ikili sıralama yapar; Türkçe alfabeye göre (Ç, Ş, Ü...) yeniden sırala.
  return all<ProductWithStock>(db, sql, ...params).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

export function getProduct(db: DB, id: string): ProductWithStock {
  const p = one<ProductWithStock>(db, `${SELECT} WHERE p.id = ?`, id);
  if (!p) throw new NotFoundError('Ürün bulunamadı');
  return p;
}

export function findByBarcode(db: DB, barcode: string): ProductWithStock {
  const p = one<ProductWithStock>(db, `${SELECT} WHERE p.barcode = ? AND p.active = 1`, barcode.trim());
  if (!p) throw new NotFoundError(`Barkod bulunamadı: ${barcode}`);
  return p;
}

function normalize(input: ProductInput) {
  return {
    barcode: optionalString(input.barcode, 'Barkod', 64),
    name: requireString(input.name, 'Ürün adı', 120),
    category: optionalString(input.category, 'Kategori', 60),
    unit: optionalString(input.unit, 'Birim', 20) ?? 'adet',
    price_kurus: requireInt(input.price_kurus, 'Fiyat', { min: 0 }),
    vat_rate: requireInt(input.vat_rate ?? 10, 'KDV oranı', { min: 0, max: 100 }),
    track_stock: input.track_stock === false ? 0 : 1,
    active: input.active === false ? 0 : 1,
  };
}

function assertBarcodeFree(db: DB, barcode: string | null, exceptId?: string) {
  if (!barcode) return;
  const other = one<{ id: string }>(db, 'SELECT id FROM products WHERE barcode = ?', barcode);
  if (other && other.id !== exceptId) throw new ConflictError(`Bu barkod başka bir üründe kayıtlı: ${barcode}`);
}

export function createProduct(db: DB, input: ProductInput, userId: string | null): ProductWithStock {
  const p = normalize(input);
  const id = newId();
  const now = nowIso();
  tx(db, () => {
    assertBarcodeFree(db, p.barcode);
    run(
      db,
      `INSERT INTO products (id, barcode, name, category, unit, price_kurus, vat_rate, track_stock, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, p.barcode, p.name, p.category, p.unit, p.price_kurus, p.vat_rate, p.track_stock, p.active, now, now,
    );
    run(db, 'INSERT INTO inventory_balances (product_id, qty, updated_at) VALUES (?, 0, ?)', id, now);
    const row = one<Product>(db, 'SELECT * FROM products WHERE id = ?', id)!;
    enqueue(db, 'product.upserted', id, row);
    audit(db, userId, 'product.create', 'product', id, { name: p.name });
  });
  return getProduct(db, id);
}

export function updateProduct(db: DB, id: string, input: ProductInput, userId: string | null): ProductWithStock {
  const p = normalize(input);
  tx(db, () => {
    const existing = one<Product>(db, 'SELECT * FROM products WHERE id = ?', id);
    if (!existing) throw new NotFoundError('Ürün bulunamadı');
    assertBarcodeFree(db, p.barcode, id);
    run(
      db,
      `UPDATE products SET barcode = ?, name = ?, category = ?, unit = ?, price_kurus = ?, vat_rate = ?,
              track_stock = ?, active = ?, updated_at = ? WHERE id = ?`,
      p.barcode, p.name, p.category, p.unit, p.price_kurus, p.vat_rate, p.track_stock, p.active, nowIso(), id,
    );
    const row = one<Product>(db, 'SELECT * FROM products WHERE id = ?', id)!;
    enqueue(db, 'product.upserted', id, row);
    audit(db, userId, 'product.update', 'product', id, { before: existing.price_kurus, after: p.price_kurus });
  });
  return getProduct(db, id);
}
