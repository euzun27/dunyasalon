import { Hono, type Context } from 'hono';
import {
  isSyncEvent,
  MAX_PUSH_BATCH,
  PROTOCOL_VERSION,
  type PullResponse,
  type PushRequest,
  type PushResult,
} from '@dunyatek/sync-protocol';
import {
  newId,
  nowIso,
  optionalString,
  requireDate,
  requireInt,
  requireString,
  requireTime,
  ValidationError,
} from '@dunyatek/shared';
import { projectionStatements } from './apply.ts';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SYNC_TOKEN: string;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.onError((err, c) => {
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) return c.json({ error: err.message }, status as 400);
  console.error(err);
  return c.json({ error: 'Beklenmeyen sunucu hatası' }, 500);
});

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  // Sabit süreli karşılaştırma (özetler eşit uzunlukta)
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

async function requireToken(c: Context<{ Bindings: Bindings }>, expected: string | undefined) {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !token || !(await safeEqual(token, expected))) {
    throw Object.assign(new Error('Yetkisiz'), { status: 401 });
  }
}

app.get('/api/health', (c) => c.json({ ok: true, mode: 'cloud', protocol: PROTOCOL_VERSION, time: nowIso() }));

// ---------- Senkronizasyon (salon mini PC → bulut) ----------

app.post('/api/sync/push', async (c) => {
  await requireToken(c, c.env.SYNC_TOKEN);
  const body = await c.req.json<PushRequest>();
  if (body.protocol !== PROTOCOL_VERSION) throw new ValidationError('Protokol sürümü uyumsuz');
  const deviceId = requireString(body.device_id, 'device_id', 64);
  if (!Array.isArray(body.events) || body.events.length > MAX_PUSH_BATCH) throw new ValidationError('Geçersiz olay listesi');

  const db = c.env.DB;
  const result: PushResult = { accepted: [], duplicates: [], rejected: [] };
  for (const e of body.events) {
    if (!isSyncEvent(e) || e.origin !== deviceId) {
      result.rejected.push({ event_id: String((e as { event_id?: string })?.event_id), error: 'Geçersiz olay' });
      continue;
    }
    const seen = await db.prepare('SELECT 1 FROM sync_events WHERE event_id = ?').bind(e.event_id).first();
    if (seen) {
      result.duplicates.push(e.event_id);
      continue;
    }
    try {
      // Olay günlüğü + projeksiyonlar tek atomik batch: ya hepsi yazılır ya hiçbiri.
      await db.batch([
        db
          .prepare(
            'INSERT INTO sync_events (event_id, type, aggregate_id, payload, origin, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(e.event_id, e.type, e.aggregate_id, JSON.stringify(e.payload), e.origin, e.occurred_at, nowIso()),
        ...projectionStatements(db, e),
      ]);
      result.accepted.push(e.event_id);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (/UNIQUE constraint failed: sync_events\.event_id/.test(msg)) result.duplicates.push(e.event_id);
      else result.rejected.push({ event_id: e.event_id, error: msg.slice(0, 300) });
    }
  }
  return c.json(result);
});

// Salondaki "Test verilerini sıfırla" işlemiyle birlikte çağrılır. Salonlar, ürünler, hizmetler,
// personel ve sync_events (çift gönderim kontrolü, son eşitleme bilgisi) korunur.
const RESET_TABLES = [
  'pos_payments', 'pos_sale_items', 'event_ledger', 'pos_sales', 'event_staff', 'reservation_items',
  'reservation_payments', 'reservation_installments', 'customer_notes', 'finance_entries', 'event_accounts',
  'reservation_requests', 'reservations', 'customers', 'stock_movements',
];

app.post('/api/sync/reset', async (c) => {
  await requireToken(c, c.env.SYNC_TOKEN);
  await c.env.DB.batch(RESET_TABLES.map((t) => c.env.DB.prepare(`DELETE FROM ${t}`)));
  return c.json({ ok: true });
});

app.get('/api/sync/pull', async (c) => {
  await requireToken(c, c.env.SYNC_TOKEN);
  const deviceId = c.req.header('x-device-id') ?? '';
  const cursor = Number(c.req.query('cursor') ?? 0) || 0;
  const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? 100) || 100), 500);
  // Tüm kaynaklardaki olaylar taranır; cihazın kendi gönderdikleri ayıklanır ama imleç
  // taranan son olaya ilerler. Böylece araya yeni olay girse bile hiçbiri atlanmaz.
  const { results } = await c.env.DB.prepare(
    `SELECT cursor, event_id, type, aggregate_id, payload, origin, occurred_at FROM sync_events
      WHERE cursor > ? ORDER BY cursor LIMIT ?`,
  )
    .bind(cursor, limit + 1)
    .all<{ cursor: number; event_id: string; type: string; aggregate_id: string; payload: string; origin: string; occurred_at: string }>();
  const scanned = results.slice(0, limit);
  const body: PullResponse = {
    events: scanned
      .filter((r) => r.origin !== deviceId)
      .map((r) => ({ ...r, type: r.type as PullResponse['events'][number]['type'], payload: JSON.parse(r.payload) })),
    next_cursor: scanned.length ? scanned[scanned.length - 1]!.cursor : cursor,
    has_more: results.length > limit,
  };
  return c.json(body);
});

// ---------- Uzaktan yönetim paneli (panel.truvapark.com.tr) ----------

const admin = new Hono<{ Bindings: Bindings }>();
admin.use('*', async (c, next) => {
  await requireToken(c, c.env.ADMIN_TOKEN);
  await next();
});

// Rezervasyon tutarları salondaki reservationMoney ile aynı kuralla hesaplanır:
// toplam = salon ücreti + kalemler − indirim; tahsil = iptal edilmemiş ödemeler − iadeler.
const RES_MONEY = `
  SELECT r.*,
         r.price_kurus - r.discount_kurus
           + COALESCE((SELECT SUM(i.total_kurus) FROM reservation_items i WHERE i.reservation_id = r.id), 0) AS total_kurus,
         COALESCE((SELECT SUM(CASE p.kind WHEN 'iade' THEN -p.amount_kurus ELSE p.amount_kurus END)
                     FROM reservation_payments p WHERE p.reservation_id = r.id AND p.cancelled_at IS NULL), 0) AS paid_kurus
    FROM reservations r`;

admin.get('/summary', async (c) => {
  const date = c.req.query('date') ?? nowIso().slice(0, 10);
  const db = c.env.DB;
  const [sales, byMethod, upcoming, lastSync, pendingRequests, resPayments, receivable] = await db.batch([
    db.prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total_kurus),0) AS total FROM pos_sales WHERE status = 'tamamlandi' AND substr(created_at,1,10) = ?",
    ).bind(date),
    db.prepare(
      `SELECT p.method, SUM(p.amount_kurus) AS total FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id
        WHERE s.status = 'tamamlandi' AND substr(s.created_at,1,10) = ? GROUP BY p.method`,
    ).bind(date),
    db.prepare(
      `SELECT r.id, r.event_date, r.start_time, r.end_time, r.status, r.event_type, r.guest_count,
              r.total_kurus, r.paid_kurus, r.total_kurus - r.paid_kurus AS balance_kurus,
              h.name AS hall_name, c.full_name AS customer_name
         FROM (${RES_MONEY}) r LEFT JOIN halls h ON h.id = r.hall_id LEFT JOIN customers c ON c.id = r.customer_id
        WHERE r.event_date >= ? AND r.status IN ('opsiyon','kesin','talep') ORDER BY r.event_date, r.start_time LIMIT 20`,
    ).bind(date),
    db.prepare("SELECT origin, MAX(received_at) AS last_received_at FROM sync_events WHERE origin != 'cloud' GROUP BY origin"),
    db.prepare("SELECT COUNT(*) AS n FROM reservation_requests WHERE status = 'bekliyor'"),
    db.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE kind WHEN 'iade' THEN -amount_kurus ELSE amount_kurus END), 0) AS total
         FROM reservation_payments WHERE cancelled_at IS NULL AND substr(created_at,1,10) = ?`,
    ).bind(date),
    db.prepare(
      `SELECT COALESCE(SUM(total_kurus - paid_kurus), 0) AS total, COUNT(*) AS count
         FROM (${RES_MONEY}) WHERE status IN ('opsiyon','kesin','tamamlandi') AND total_kurus > paid_kurus`,
    ),
  ]);
  return c.json({
    date,
    sales: sales!.results[0],
    by_method: byMethod!.results,
    upcoming: upcoming!.results,
    devices: lastSync!.results,
    pending_requests: (pendingRequests!.results[0] as { n: number }).n,
    reservation_payments: resPayments!.results[0],
    receivable: receivable!.results[0],
  });
});

admin.get('/sales', async (c) => {
  const date = c.req.query('date') ?? nowIso().slice(0, 10);
  const { results } = await c.env.DB.prepare('SELECT * FROM pos_sales WHERE substr(created_at,1,10) = ? ORDER BY receipt_no DESC LIMIT 500')
    .bind(date)
    .all();
  return c.json(results);
});

admin.get('/stock', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.barcode, p.name, p.category, p.price_kurus, COALESCE(b.qty, 0) AS stock_qty
       FROM products p LEFT JOIN inventory_balances b ON b.product_id = p.id WHERE p.active = 1 ORDER BY p.name`,
  ).all();
  return c.json(results);
});

admin.get('/reservations', async (c) => {
  const from = c.req.query('from') ?? nowIso().slice(0, 10);
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, h.name AS hall_name, c.full_name AS customer_name, c.phone AS customer_phone
       FROM reservations r LEFT JOIN halls h ON h.id = r.hall_id LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.event_date >= ? ORDER BY r.event_date, r.start_time LIMIT 500`,
  )
    .bind(from)
    .all();
  return c.json(results);
});

admin.get('/halls', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM halls WHERE active = 1 ORDER BY name').all();
  return c.json(results);
});

/**
 * Uzaktan rezervasyon yalnızca TALEP olarak alınır. Kesinleştirme ve çakışma kontrolü
 * salondaki mini PC'de yapılır (sync pull ile talep oraya ulaşır).
 */
admin.post('/reservation-requests', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const req = {
    id: newId(),
    hall_id: requireString(b.hall_id, 'Salon', 64),
    customer_name: requireString(b.customer_name, 'Müşteri adı', 120),
    customer_phone: optionalString(b.customer_phone, 'Telefon', 30),
    event_type: optionalString(b.event_type, 'Etkinlik türü', 40) ?? 'dugun',
    event_date: requireDate(b.event_date, 'Tarih'),
    start_time: requireTime(b.start_time, 'Başlangıç saati'),
    end_time: requireTime(b.end_time, 'Bitiş saati'),
    guest_count: b.guest_count == null ? null : requireInt(b.guest_count, 'Davetli sayısı', { min: 0 }),
    notes: optionalString(b.notes, 'Notlar', 2000),
  };
  const now = nowIso();
  const db = c.env.DB;
  await db.batch([
    db.prepare(
      `INSERT INTO reservation_requests (id, hall_id, customer_name, customer_phone, event_type, event_date, start_time, end_time, guest_count, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(req.id, req.hall_id, req.customer_name, req.customer_phone, req.event_type, req.event_date, req.start_time, req.end_time, req.guest_count, req.notes, now),
    db.prepare(
      'INSERT INTO sync_events (event_id, type, aggregate_id, payload, origin, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(newId(), 'reservation_request.created', req.id, JSON.stringify(req), 'cloud', now, now),
  ]);
  return c.json({ ...req, status: 'bekliyor' }, 201);
});

app.route('/api/cloud', admin);

app.all('/api/*', (c) => c.json({ error: 'Bulunamadı' }, 404));

export default app;
