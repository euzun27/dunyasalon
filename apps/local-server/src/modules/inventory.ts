import { newId, nowIso, NotFoundError, ValidationError, optionalString, requireInt, type StockMovementType } from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue } from '../database/outbox.ts';

export interface MovementRow {
  id: string;
  product_id: string;
  type: StockMovementType;
  qty_delta: number;
  unit_cost_kurus: number | null;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  user_id: string | null;
  created_at: string;
}

/**
 * Tek bir stok hareketi yazar ve bakiyeyi günceller. Çağıran transaction içinde olmalıdır.
 * Bakiye sıfırın altına düşerse hata verir (aynı son ürünü iki kasa satamaz).
 */
export function applyMovement(
  db: DB,
  m: Omit<MovementRow, 'id' | 'created_at'> & { id?: string; created_at?: string },
): MovementRow {
  const product = one<{ name: string; track_stock: number }>(db, 'SELECT name, track_stock FROM products WHERE id = ?', m.product_id);
  if (!product) throw new NotFoundError('Ürün bulunamadı');
  const row: MovementRow = {
    id: m.id ?? newId(),
    product_id: m.product_id,
    type: m.type,
    qty_delta: m.qty_delta,
    unit_cost_kurus: m.unit_cost_kurus ?? null,
    ref_type: m.ref_type ?? null,
    ref_id: m.ref_id ?? null,
    note: m.note ?? null,
    user_id: m.user_id ?? null,
    created_at: m.created_at ?? nowIso(),
  };
  if (product.track_stock) {
    const bal = one<{ qty: number }>(db, 'SELECT qty FROM inventory_balances WHERE product_id = ?', m.product_id)?.qty ?? 0;
    if (bal + m.qty_delta < 0) {
      throw new ValidationError(`Yetersiz stok: ${product.name} (mevcut ${bal / 1000})`);
    }
  }
  run(
    db,
    `INSERT INTO stock_movements (id, product_id, type, qty_delta, unit_cost_kurus, ref_type, ref_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.product_id, row.type, row.qty_delta, row.unit_cost_kurus, row.ref_type, row.ref_id, row.note, row.user_id, row.created_at,
  );
  if (product.track_stock) {
    // Önce UPDATE: negatif delta ile INSERT ... ON CONFLICT, CHECK kısıtına takılır.
    const upd = run(db, 'UPDATE inventory_balances SET qty = qty + ?, updated_at = ? WHERE product_id = ?',
      row.qty_delta, row.created_at, row.product_id);
    if (upd.changes === 0) {
      run(db, 'INSERT INTO inventory_balances (product_id, qty, updated_at) VALUES (?, ?, ?)', row.product_id, row.qty_delta, row.created_at);
    }
  }
  return row;
}

export interface ManualMovementInput {
  product_id: string;
  type: 'giris' | 'sayim' | 'fire';
  qty: number; // giriş/fire için pozitif miktar; sayımda sayılan yeni miktar
  unit_cost_kurus?: number | null;
  note?: string | null;
}

export function recordManualMovement(db: DB, input: ManualMovementInput, userId: string | null): MovementRow {
  if (!['giris', 'sayim', 'fire'].includes(input.type)) throw new ValidationError('Geçersiz hareket türü');
  const qty = requireInt(input.qty, 'Miktar', { min: 0 });
  const note = optionalString(input.note, 'Not', 300);
  return tx(db, () => {
    let delta: number;
    if (input.type === 'sayim') {
      const bal = one<{ qty: number }>(db, 'SELECT qty FROM inventory_balances WHERE product_id = ?', input.product_id)?.qty ?? 0;
      delta = qty - bal;
    } else {
      if (qty === 0) throw new ValidationError('Miktar sıfırdan büyük olmalıdır');
      delta = input.type === 'giris' ? qty : -qty;
    }
    const mv = applyMovement(db, {
      product_id: input.product_id,
      type: input.type,
      qty_delta: delta,
      unit_cost_kurus: input.unit_cost_kurus ?? null,
      ref_type: 'manuel',
      ref_id: null,
      note,
      user_id: userId,
    });
    enqueue(db, 'stock.moved', mv.id, mv);
    audit(db, userId, `stock.${input.type}`, 'product', input.product_id, { delta });
    return mv;
  });
}

export function listMovements(db: DB, productId?: string, limit = 200): Array<MovementRow & { product_name: string }> {
  const where = productId ? 'WHERE m.product_id = ?' : '';
  const params = productId ? [productId] : [];
  return all(
    db,
    `SELECT m.*, p.name AS product_name FROM stock_movements m JOIN products p ON p.id = m.product_id
     ${where} ORDER BY m.created_at DESC LIMIT ${Math.min(Math.max(1, limit), 1000)}`,
    ...params,
  );
}
