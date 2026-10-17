import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQty } from '@dunyatek/shared';
import worker from '../../apps/cloud-worker/src/index.ts';
import { completeSale, refundSale } from '../../apps/local-server/src/modules/pos.ts';
import { createReservation } from '../../apps/local-server/src/modules/reservations.ts';
import { SyncEngine } from '../../apps/local-server/src/sync/engine.ts';
import { run, type DB } from '../../apps/local-server/src/database/db.ts';
import { D1Shim } from '../helpers/d1-shim.ts';
import { count, freshDb, seed } from '../helpers/setup.ts';

const SYNC_TOKEN = 'test-sync-token';
const ADMIN_TOKEN = 'test-admin-token';

function cloud() {
  const d1 = new D1Shim();
  const env = { DB: d1, SYNC_TOKEN, ADMIN_TOKEN, ASSETS: { fetch: async () => new Response('') } };
  let online = true;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!online) throw new TypeError('fetch failed: internet yok');
    return worker.fetch(new Request(input, init), env as never);
  }) as typeof fetch;
  return {
    d1,
    env,
    fetch: fetchImpl,
    setOnline(v: boolean) {
      online = v;
    },
    admin: (path: string, init: RequestInit = {}) =>
      worker.fetch(
        new Request(`https://dunyasalon.com/api/cloud${path}`, {
          ...init,
          headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        }),
        env as never,
      ),
  };
}

function engine(db: DB, fetchImpl: typeof fetch) {
  return new SyncEngine(db, {
    deviceId: 'salon-mini-pc-1',
    cloudUrl: 'https://dunyasalon.com',
    cloudToken: SYNC_TOKEN,
    reservationBufferMinutes: 60,
    fetch: fetchImpl,
  });
}

const retryNow = (db: DB) => run(db, 'UPDATE sync_outbox SET next_attempt_at = NULL');
const ctx = (userId: string) => ({ userId, terminal: 'KASA-1' });

test('internet kesikken 100 satış kuyrukta bekler, bağlantı gelince buluta birer kez işlenir', async () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const c = cloud();
  const sync = engine(db, c.fetch);

  c.setOnline(false);
  for (let i = 0; i < 100; i++) {
    completeSale(db, { lines: [{ product_id: kola.id, qty: toQty(1) }], payments: [{ method: 'nakit', amount_kurus: 4000 }] }, ctx(admin.id));
  }
  await sync.runOnce();
  assert.equal(sync.status().online, false);
  assert.ok(sync.status().pending >= 100);
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM pos_sales'), 0);

  c.setOnline(true);
  retryNow(db);
  await sync.runOnce();
  assert.equal(sync.status().pending, 0);
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM pos_sales'), 100);
  const stock = c.d1.db.prepare('SELECT qty FROM inventory_balances WHERE product_id = ?').get(kola.id) as { qty: number };
  assert.equal(stock.qty, toQty(0));
});

test('aynı olaylar ikinci kez gönderilirse bulutta çift satış/stok oluşmaz', async () => {
  const db = freshDb();
  const { admin, kola } = seed(db);
  const c = cloud();
  const sync = engine(db, c.fetch);
  completeSale(db, { lines: [{ product_id: kola.id, qty: toQty(5) }], payments: [{ method: 'kart', amount_kurus: 20000 }] }, ctx(admin.id));
  await sync.runOnce();
  const sent = count(c.d1.db, 'SELECT COUNT(*) AS n FROM sync_events');

  // Bulut onayı yerel tarafa ulaşmamış gibi: tüm olayları yeniden gönder.
  run(db, "UPDATE sync_outbox SET status = 'bekliyor', next_attempt_at = NULL");
  await sync.runOnce();
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM sync_events'), sent);
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM pos_sales'), 1);
  const stock = c.d1.db.prepare('SELECT qty FROM inventory_balances WHERE product_id = ?').get(kola.id) as { qty: number };
  assert.equal(stock.qty, toQty(95));
  assert.equal(sync.status().pending, 0);
});

test('iade ve düğün hesabı hareketleri buluta yansır', async () => {
  const db = freshDb();
  const { admin, kola, hall } = seed(db);
  const c = cloud();
  const sync = engine(db, c.fetch);
  const r = createReservation(
    db,
    { hall_id: hall.id, customer_name: 'Ayşe', customer_phone: '0555', event_date: '2027-06-12', start_time: '19:00', end_time: '00:00', status: 'kesin' },
    { userId: admin.id, bufferMinutes: 60 },
  );
  const sale = completeSale(
    db,
    { lines: [{ product_id: kola.id, qty: toQty(2) }], payments: [{ method: 'dugun_hesabi', amount_kurus: 8000 }], event_account_id: r.event_account_id },
    ctx(admin.id),
  );
  refundSale(db, sale.id, ctx(admin.id));
  await sync.runOnce();
  assert.equal((c.d1.db.prepare('SELECT status FROM pos_sales WHERE id = ?').get(sale.id) as { status: string }).status, 'iade');
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM event_ledger'), 2);
  assert.equal(count(c.d1.db, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'kesin'"), 1);
  const stock = c.d1.db.prepare('SELECT qty FROM inventory_balances WHERE product_id = ?').get(kola.id) as { qty: number };
  assert.equal(stock.qty, toQty(100));
});

test('uzaktan alınan rezervasyon talebi yerelde "talep" olarak düşer ve salonu kilitlemez', async () => {
  const db = freshDb();
  const { hall } = seed(db);
  const c = cloud();
  const sync = engine(db, c.fetch);
  await sync.runOnce(); // salon bilgisi buluta gitsin

  const res = await c.admin('/reservation-requests', {
    method: 'POST',
    body: JSON.stringify({ hall_id: hall.id, customer_name: 'Uzak Müşteri', customer_phone: '0532', event_date: '2027-07-01', start_time: '19:00', end_time: '23:00' }),
  });
  assert.equal(res.status, 201);
  const pulled = await sync.runOnce();
  assert.equal(pulled.pulled, 1);
  const local = (db.prepare('SELECT status, source FROM reservations').all() as Array<{ status: string; source: string }>).map((r) => ({ ...r }));
  assert.deepEqual(local, [{ status: 'talep', source: 'bulut' }]);
  // Tekrar çekmede aynı talep ikinci kez işlenmez
  await sync.runOnce();
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM reservations'), 1);
  // Talep salonu kilitlemez: resepsiyon aynı saate kesin rezervasyon girebilir
  const kesin = createReservation(
    db,
    { hall_id: hall.id, customer_name: 'Salondaki Müşteri', customer_phone: '0544', event_date: '2027-07-01', start_time: '19:00', end_time: '23:00', status: 'kesin' },
    { userId: null, bufferMinutes: 60 },
  );
  assert.equal(kesin.status, 'kesin');
});

test('yanlış senkron anahtarı reddedilir', async () => {
  const db = freshDb();
  seed(db);
  const c = cloud();
  const sync = new SyncEngine(db, { deviceId: 'x', cloudUrl: 'https://dunyasalon.com', cloudToken: 'yanlis', reservationBufferMinutes: 60, fetch: c.fetch });
  await sync.runOnce();
  assert.equal(sync.status().online, false);
  assert.match(sync.status().last_error ?? '', /401/);
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM sync_events'), 0);
});

test('tahsilat, menü kalemi ve gider kayıtları buluta eşitlenir', async () => {
  const { saveService } = await import('../../apps/local-server/src/modules/services.ts');
  const { addItem, addPayment, cancelPayment } = await import('../../apps/local-server/src/modules/reservation-details.ts');
  const { addEntry } = await import('../../apps/local-server/src/modules/finance.ts');
  const db = freshDb();
  const { admin, hall } = seed(db);
  const c = cloud();
  const sync = engine(db, c.fetch);
  const r = createReservation(
    db,
    { hall_id: hall.id, customer_name: 'Ayşe', customer_phone: '0555', event_date: '2027-06-12', start_time: '19:00', end_time: '00:00', guest_count: 100, price_kurus: 1_000_000, status: 'kesin' },
    { userId: admin.id, bufferMinutes: 60 },
  );
  const menu = saveService(db, null, { name: 'Menü', kind: 'menu', pricing: 'kisi_basi', price_kurus: 40_000 }, admin.id);
  addItem(db, r.id, { service_id: menu.id }, admin.id);
  const p = addPayment(db, r.id, { kind: 'kapora', method: 'nakit', amount_kurus: 500_000 }, admin.id);
  cancelPayment(db, p.id, 'yanlış', admin.id);
  addEntry(db, { type: 'gider', category: 'Kira', amount_kurus: 100_000, entry_date: '2027-06-01' }, admin.id);
  await sync.runOnce();
  assert.equal(sync.status().pending, 0);
  const item = c.d1.db.prepare('SELECT total_kurus FROM reservation_items').get() as { total_kurus: number };
  assert.equal(item.total_kurus, 4_000_000);
  const pay = c.d1.db.prepare('SELECT cancelled_at FROM reservation_payments').get() as { cancelled_at: string | null };
  assert.ok(pay.cancelled_at);
  assert.equal(count(c.d1.db, 'SELECT COUNT(*) AS n FROM finance_entries'), 1);
});
