import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQty } from '@dunyatek/shared';
import { importProducts, parseMoneyCell } from '../../apps/local-server/src/modules/products-import.ts';
import { getProduct, listProducts } from '../../apps/local-server/src/modules/products.ts';
import { count, freshDb, seed } from '../helpers/setup.ts';

test('fiyat hücreleri Türkçe ve Excel biçimlerinden kuruşa çevrilir', () => {
  assert.equal(parseMoneyCell('1.250,50 ₺'), 125050);
  assert.equal(parseMoneyCell('12,5'), 1250);
  assert.equal(parseMoneyCell('12.50'), 1250);
  assert.equal(parseMoneyCell(40), 4000);
  assert.equal(parseMoneyCell(''), null);
  assert.ok(Number.isNaN(parseMoneyCell('bedava')));
});

test('toplu yükleme: yeni ürün ekler, barkodla eşleşeni günceller, stok girer, hatalı satırı atlar', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const outboxBefore = count(db, 'SELECT COUNT(*) AS n FROM sync_outbox');
  const report = importProducts(
    db,
    [
      { barcode: '8690000000001', name: 'Kola 330 ml', category: 'İçecek', price: '45,00', vat_rate: 20, stock: 24 },
      { barcode: 8690504000035, name: 'Ayran 300 ml', category: 'İçecek', price: 30, stock: '48' },
      { barcode: '', name: 'Kolonya 100 ml', category: 'Hediyelik', price: '75' },
      { barcode: '8690000000009', name: 'Fiyatsız ürün', price: '' },
      { barcode: '8690504000035', name: 'Ayran tekrar', price: 30 },
      { barcode: '', name: '', price: '' },
    ],
    {},
    admin.id,
  );
  assert.deepEqual(report, {
    total: 5, created: 2, updated: 1, unchanged: 0, stock_entries: 2,
    errors: [{ row: 5, message: 'Satış fiyatı boş' }, { row: 6, message: 'Aynı ürün 3. satırda da var' }],
  });
  const k = getProduct(db, kola.id);
  assert.equal(k.name, 'Kola 330 ml');
  assert.equal(k.price_kurus, 4500);
  assert.equal(k.vat_rate, 20);
  assert.equal(k.stock_qty, toQty(124));
  const ayran = listProducts(db, { q: '8690504000035' })[0]!;
  assert.equal(ayran.stock_qty, toQty(48));
  assert.equal(ayran.vat_rate, 10);
  const kolonya = listProducts(db, { q: 'Kolonya' })[0]!;
  assert.equal(kolonya.barcode, null);
  assert.ok(count(db, 'SELECT COUNT(*) AS n FROM sync_outbox') > outboxBefore, 'ürünler buluta gönderilmek üzere kuyruğa girer');

  // Aynı dosya tekrar yüklenince ad ile eşleşir, ikinci kez ürün açmaz
  const again = importProducts(db, [{ name: 'kolonya 100 ml', category: 'Hediyelik', price: '75' }], {}, admin.id);
  assert.equal(again.created, 0);
  assert.equal(again.updated, 1);
});

test('önizleme (dry run) hiçbir şey kaydetmez', () => {
  const db = freshDb();
  const { admin } = seed(db);
  const products = count(db, 'SELECT COUNT(*) AS n FROM products');
  const outbox = count(db, 'SELECT COUNT(*) AS n FROM sync_outbox');
  const report = importProducts(db, [{ name: 'Cips', price: '50', stock: 10 }], { dryRun: true }, admin.id);
  assert.equal(report.created, 1);
  assert.equal(report.stock_entries, 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM products'), products);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sync_outbox'), outbox);
});
