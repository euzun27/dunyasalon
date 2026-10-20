import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQty } from '@dunyatek/shared';
import { recordStockCount } from '../../apps/local-server/src/modules/inventory.ts';
import { getProduct } from '../../apps/local-server/src/modules/products.ts';
import { count, freshDb, seed } from '../helpers/setup.ts';

test('barkodla sayım: stoklar sayılan miktara eşitlenir, değişmeyene hareket yazılmaz', () => {
  const db = freshDb();
  const { admin, kola, su } = seed(db);
  const before = count(db, 'SELECT COUNT(*) AS n FROM stock_movements');
  const report = recordStockCount(db, [{ product_id: kola.id, qty: toQty(87) }, { product_id: su.id, qty: toQty(1) }], admin.id);
  assert.deepEqual(report, { counted: 2, changed: 1, unchanged: 1 });
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(87));
  assert.equal(getProduct(db, su.id).stock_qty, toQty(1));
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM stock_movements'), before + 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'sayim' AND qty_delta = ?", String(toQty(-13))), 1);
});

test('barkodla sayım: hatalı satırda hiçbir şey kaydedilmez', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  assert.throws(() => recordStockCount(db, [{ product_id: kola.id, qty: toQty(5) }, { product_id: 'yok', qty: toQty(1) }], admin.id), /Ürün bulunamadı/);
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(100));
  assert.throws(() => recordStockCount(db, [{ product_id: kola.id, qty: 1 }, { product_id: kola.id, qty: 2 }], admin.id), /iki kez/);
});
