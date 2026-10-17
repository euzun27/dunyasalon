import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQty } from '@dunyatek/shared';
import { completeSale, refundSale } from '../../apps/local-server/src/modules/pos.ts';
import { createEventAccount, getEventAccount } from '../../apps/local-server/src/modules/event-accounts.ts';
import { getProduct } from '../../apps/local-server/src/modules/products.ts';
import { count, freshDb, seed } from '../helpers/setup.ts';

const ctx = (userId: string) => ({ userId, terminal: 'KASA-1' });

test('barkodlu nakit satış: satış, stok düşümü ve senkron olayı tek işlemde yazılır', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const before = count(db, 'SELECT COUNT(*) AS n FROM sync_outbox');
  const sale = completeSale(
    db,
    { lines: [{ barcode: '8690000000001', qty: toQty(3) }], payments: [{ method: 'nakit', amount_kurus: 12000 }] },
    ctx(admin.id),
  );
  assert.equal(sale.total_kurus, 12000);
  assert.equal(sale.receipt_no, 1);
  assert.equal(sale.items.length, 1);
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(97));
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'satis'"), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sync_outbox') - before, 1);
});

test('aynı satış kimliğiyle tekrar gönderim çift satış ve çift stok düşümü yapmaz', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const input = { id: 'sale-retry-1', lines: [{ product_id: kola.id, qty: toQty(2) }], payments: [{ method: 'kart' as const, amount_kurus: 8000 }] };
  const first = completeSale(db, input, ctx(admin.id));
  const second = completeSale(db, input, ctx(admin.id));
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.receipt_no, first.receipt_no);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pos_sales'), 1);
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(98));
});

test('son ürünü iki kasa satmaya çalışırsa yalnızca biri başarılı olur', () => {
  const db = freshDb();
  const { admin, su } = seed(db); // su stoğu: 1
  const sell = (terminal: string) =>
    completeSale(db, { lines: [{ product_id: su.id, qty: toQty(1) }], payments: [{ method: 'nakit', amount_kurus: 1500 }] }, { userId: admin.id, terminal });
  sell('KASA-1');
  assert.throws(() => sell('KASA-2'), /Yetersiz stok/);
  assert.equal(getProduct(db, su.id).stock_qty, 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pos_sales'), 1);
});

test('hatalı ödeme tutarında hiçbir kayıt oluşmaz (atomik geri alma)', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const outbox = count(db, 'SELECT COUNT(*) AS n FROM sync_outbox');
  assert.throws(
    () => completeSale(db, { lines: [{ product_id: kola.id, qty: toQty(1) }], payments: [{ method: 'nakit', amount_kurus: 100 }] }, ctx(admin.id)),
    /Ödeme toplamı/,
  );
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pos_sales'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sync_outbox'), outbox);
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(100));
});

test('düğün hesabına yazılan satış hesaba borç olarak işlenir, iadesi alacak olarak düşer', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const acc = createEventAccount(db, { title: 'Ayşe & Mehmet' }, admin.id);
  const sale = completeSale(
    db,
    { lines: [{ product_id: kola.id, qty: toQty(10) }], payments: [{ method: 'dugun_hesabi', amount_kurus: 40000 }], event_account_id: acc.id },
    ctx(admin.id),
  );
  assert.equal(getEventAccount(db, acc.id).balance_kurus, 40000);
  refundSale(db, sale.id, ctx(admin.id), 'Yanlış hesap');
  assert.equal(getEventAccount(db, acc.id).balance_kurus, 0);
  assert.equal(getProduct(db, kola.id).stock_qty, toQty(100));
  assert.throws(() => refundSale(db, sale.id, ctx(admin.id)), /zaten iade/);
});

test('düğün hesabı seçilmeden hesaba yazılamaz; limit aşılamaz', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  assert.throws(
    () => completeSale(db, { lines: [{ product_id: kola.id, qty: toQty(1) }], payments: [{ method: 'dugun_hesabi', amount_kurus: 4000 }] }, ctx(admin.id)),
    /organizasyon hesabı seçilmelidir/,
  );
  const acc = createEventAccount(db, { title: 'Limitli', credit_limit_kurus: 5000 }, admin.id);
  assert.throws(
    () =>
      completeSale(
        db,
        { lines: [{ product_id: kola.id, qty: toQty(2) }], payments: [{ method: 'dugun_hesabi', amount_kurus: 8000 }], event_account_id: acc.id },
        ctx(admin.id),
      ),
    /limiti aşılıyor/,
  );
});

test('kesinti sırasında 100 satış: hepsi yerelde kayıtlı ve kuyrukta bekliyor', () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  for (let i = 0; i < 100; i++) {
    completeSale(db, { lines: [{ product_id: kola.id, qty: toQty(1) }], payments: [{ method: 'nakit', amount_kurus: 4000 }] }, ctx(admin.id));
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM pos_sales'), 100);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sync_outbox WHERE type = 'sale.completed' AND status = 'bekliyor'"), 100);
  assert.equal(getProduct(db, kola.id).stock_qty, 0);
});

test('Türkçe tutar yazımı doğru kuruşa çevrilir', async () => {
  const { toKurus, formatTL } = await import('@dunyatek/shared');
  assert.equal(toKurus('150.000'), 15_000_000);
  assert.equal(toKurus('1.250,50'), 125_050);
  assert.equal(toKurus('12,5'), 1250);
  assert.equal(toKurus('12.50'), 1250);
  assert.equal(formatTL(15_000_000), '150.000,00 ₺');
});
