import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Role } from '@dunyatek/shared';
import type { Config } from './config.ts';
import type { DB } from './database/db.ts';
import { AuthError, assertRole, createUser, listUsers, login, logout, updateUser, userFromToken, type SessionUser } from './modules/auth.ts';
import * as products from './modules/products.ts';
import * as inventory from './modules/inventory.ts';
import * as pos from './modules/pos.ts';
import * as accounts from './modules/event-accounts.ts';
import * as reservations from './modules/reservations.ts';
import { dailySummary, yearlyReport } from './modules/reports.ts';
import * as services from './modules/services.ts';
import * as details from './modules/reservation-details.ts';
import * as customers from './modules/customers.ts';
import * as finance from './modules/finance.ts';
import * as staff from './modules/staff.ts';
import * as settings from './modules/settings.ts';
import { dashboard } from './modules/dashboard.ts';
import { resetTestData } from './modules/reset.ts';
import type { SyncEngine } from './sync/engine.ts';

type Env = { Variables: { user: SessionUser } };

export function createApp(db: DB, config: Config, sync?: SyncEngine) {
  const app = new Hono<Env>();
  const api = new Hono<Env>();

  app.onError((err, c) => {
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      return c.json({ error: err.message }, status as 400);
    }
    console.error(err);
    return c.json({ error: 'Beklenmeyen sunucu hatası' }, 500);
  });

  api.get('/health', (c) =>
    c.json({ ok: true, device_id: config.deviceId, time: new Date().toISOString(), sync: sync?.status() ?? null }),
  );

  api.post('/auth/login', async (c) => {
    const body = await c.req.json<{ username: string; password: string }>();
    return c.json(login(db, body.username, body.password, config.sessionHours));
  });

  // Bundan sonraki tüm uçlar oturum ister.
  api.use('*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : getCookie(c, 'session');
    const user = userFromToken(db, token);
    if (!user) throw new AuthError('Oturum açmanız gerekiyor');
    c.set('user', user);
    await next();
  });

  const role = (c: Context<Env>, ...roles: Role[]) => {
    const user = c.get('user');
    assertRole(user, roles);
    return user;
  };
  const terminalOf = (c: Context<Env>) => c.req.header('x-terminal') || 'KASA-1';

  api.get('/auth/me', (c) => c.json(c.get('user')));
  api.post('/auth/logout', (c) => {
    const header = c.req.header('authorization');
    if (header?.startsWith('Bearer ')) logout(db, header.slice(7));
    return c.json({ ok: true });
  });
  api.get('/users', (c) => {
    role(c, 'admin');
    return c.json(listUsers(db));
  });
  api.post('/users', async (c) => {
    role(c, 'admin');
    return c.json(createUser(db, await c.req.json()), 201);
  });
  api.put('/users/:id', async (c) => {
    const u = role(c, 'admin');
    return c.json(updateUser(db, c.req.param('id'), await c.req.json(), u.id));
  });

  // --- Ürünler ve stok ---
  api.get('/products', (c) =>
    c.json(products.listProducts(db, { q: c.req.query('q'), includeInactive: c.req.query('all') === '1' })),
  );
  api.get('/products/barcode/:barcode', (c) => c.json(products.findByBarcode(db, c.req.param('barcode'))));
  api.get('/products/:id', (c) => c.json(products.getProduct(db, c.req.param('id'))));
  api.post('/products', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(products.createProduct(db, await c.req.json(), u.id), 201);
  });
  api.put('/products/:id', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(products.updateProduct(db, c.req.param('id'), await c.req.json(), u.id));
  });
  api.get('/stock/movements', (c) =>
    c.json(inventory.listMovements(db, c.req.query('product_id'), Number(c.req.query('limit') ?? 200))),
  );
  api.post('/stock/movements', async (c) => {
    const u = role(c, 'muhasebe', 'kasiyer');
    return c.json(inventory.recordManualMovement(db, await c.req.json(), u.id), 201);
  });

  // --- Kantin POS ---
  api.post('/pos/sales', async (c) => {
    const u = role(c, 'kasiyer');
    const result = pos.completeSale(db, await c.req.json(), { userId: u.id, terminal: terminalOf(c) });
    return c.json(result, result.duplicate ? 200 : 201);
  });
  api.get('/pos/sales', (c) => c.json(pos.listSales(db, { date: c.req.query('date'), limit: Number(c.req.query('limit') ?? 100) })));
  api.get('/pos/sales/:id', (c) => c.json(pos.getSale(db, c.req.param('id'))));
  api.post('/pos/sales/:id/refund', async (c) => {
    const u = role(c, 'muhasebe');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
    return c.json(pos.refundSale(db, c.req.param('id'), { userId: u.id, terminal: terminalOf(c) }, body.reason));
  });
  api.get('/pos/cash-session', (c) => c.json(pos.currentCashSession(db, terminalOf(c))));
  api.post('/pos/cash-session/open', async (c) => {
    const u = role(c, 'kasiyer');
    const body = await c.req.json<{ opening_cash_kurus: number }>();
    return c.json(pos.openCashSession(db, terminalOf(c), body.opening_cash_kurus ?? 0, u.id), 201);
  });
  api.post('/pos/cash-session/close', async (c) => {
    const u = role(c, 'kasiyer');
    const body = await c.req.json<{ counted_cash_kurus: number }>();
    return c.json(pos.closeCashSession(db, terminalOf(c), body.counted_cash_kurus, u.id));
  });

  // --- Organizasyon (düğün) hesapları ---
  api.get('/event-accounts', (c) => {
    const status = c.req.query('status');
    return c.json(accounts.listEventAccounts(db, { status: status === 'acik' || status === 'kapali' ? status : undefined }));
  });
  api.post('/event-accounts', async (c) => {
    const u = role(c, 'resepsiyon', 'muhasebe');
    return c.json(accounts.createEventAccount(db, await c.req.json(), u.id), 201);
  });
  api.get('/event-accounts/:id', (c) => {
    const id = c.req.param('id');
    return c.json({ ...accounts.getEventAccount(db, id), ledger: accounts.getLedger(db, id) });
  });
  api.post('/event-accounts/:id/entries', async (c) => {
    const u = role(c, 'muhasebe', 'resepsiyon');
    return c.json(accounts.addManualEntry(db, c.req.param('id'), await c.req.json(), u.id), 201);
  });
  api.post('/event-accounts/:id/status', async (c) => {
    const u = role(c, 'muhasebe');
    const body = await c.req.json<{ status: 'acik' | 'kapali' }>();
    return c.json(accounts.setAccountStatus(db, c.req.param('id'), body.status, u.id));
  });

  // --- Salonlar ve rezervasyonlar ---
  const resCtx = (u: SessionUser) => ({ userId: u.id, bufferMinutes: config.reservationBufferMinutes });
  api.get('/halls', (c) => c.json(reservations.listHalls(db)));
  api.post('/halls', async (c) => {
    const u = role(c, 'admin');
    return c.json(reservations.createHall(db, await c.req.json(), u.id), 201);
  });
  api.put('/halls/:id', async (c) => {
    const u = role(c, 'admin');
    return c.json(reservations.updateHall(db, c.req.param('id'), await c.req.json(), u.id));
  });
  api.get('/reservations', (c) =>
    c.json(
      reservations.listReservations(db, {
        from: c.req.query('from'),
        to: c.req.query('to'),
        hall_id: c.req.query('hall_id'),
        status: c.req.query('status'),
      }),
    ),
  );
  api.get('/reservations/availability', (c) =>
    c.json(
      reservations.checkAvailability(
        db,
        {
          hall_id: c.req.query('hall_id') ?? '',
          event_date: c.req.query('event_date') ?? '',
          start_time: c.req.query('start_time') ?? '',
          end_time: c.req.query('end_time') ?? '',
          exclude_id: c.req.query('exclude_id'),
        },
        config.reservationBufferMinutes,
      ),
    ),
  );
  api.get('/reservations/:id', (c) => c.json(reservations.getReservation(db, c.req.param('id'))));
  api.post('/reservations', async (c) => {
    const u = role(c, 'resepsiyon');
    return c.json(reservations.createReservation(db, await c.req.json(), resCtx(u)), 201);
  });
  api.put('/reservations/:id', async (c) => {
    const u = role(c, 'resepsiyon');
    return c.json(reservations.updateReservation(db, c.req.param('id'), await c.req.json(), resCtx(u)));
  });
  api.post('/reservations/:id/status', async (c) => {
    const u = role(c, 'resepsiyon');
    const body = await c.req.json<{ status: Parameters<typeof reservations.setReservationStatus>[2] }>();
    return c.json(reservations.setReservationStatus(db, c.req.param('id'), body.status, resCtx(u)));
  });

  // --- Rezervasyon ayrıntıları: menü/hizmet, tahsilat, ödeme planı, personel ---
  api.get('/reservations/:id/detail', (c) => c.json(details.reservationDetail(db, c.req.param('id'))));
  api.post('/reservations/:id/items', async (c) => {
    const u = role(c, 'resepsiyon');
    return c.json(details.addItem(db, c.req.param('id'), await c.req.json(), u.id), 201);
  });
  api.put('/reservation-items/:id', async (c) => {
    const u = role(c, 'resepsiyon');
    const body = await c.req.json<{ qty: number }>();
    return c.json(details.updateItemQty(db, c.req.param('id'), body.qty, u.id));
  });
  api.delete('/reservation-items/:id', (c) => {
    const u = role(c, 'resepsiyon');
    details.removeItem(db, c.req.param('id'), u.id);
    return c.json({ ok: true });
  });
  api.post('/reservations/:id/payments', async (c) => {
    const u = role(c, 'resepsiyon', 'muhasebe');
    return c.json(details.addPayment(db, c.req.param('id'), await c.req.json(), u.id), 201);
  });
  api.get('/reservation-payments/:id', (c) => c.json(details.getPayment(db, c.req.param('id'))));
  api.post('/reservation-payments/:id/cancel', async (c) => {
    const u = role(c, 'muhasebe');
    const body = await c.req.json<{ reason: string }>();
    return c.json(details.cancelPayment(db, c.req.param('id'), body.reason, u.id));
  });
  api.post('/reservations/:id/installments', async (c) => {
    const u = role(c, 'resepsiyon', 'muhasebe');
    return c.json(details.addInstallment(db, c.req.param('id'), await c.req.json(), u.id), 201);
  });
  api.delete('/reservation-installments/:id', (c) => {
    const u = role(c, 'resepsiyon', 'muhasebe');
    details.removeInstallment(db, c.req.param('id'), u.id);
    return c.json({ ok: true });
  });
  api.post('/reservations/:id/staff', async (c) => {
    const u = role(c, 'resepsiyon');
    return c.json({ id: details.assignStaff(db, c.req.param('id'), await c.req.json(), u.id) }, 201);
  });
  api.delete('/event-staff/:id', (c) => {
    const u = role(c, 'resepsiyon');
    details.unassignStaff(db, c.req.param('id'), u.id);
    return c.json({ ok: true });
  });
  api.get('/reservations/:id/message', (c) =>
    c.json(settings.composeMessage(db, c.req.param('id'), c.req.query('template') ?? 'rezervasyon_onay', {
      tutar: c.req.query('tutar') ?? '',
      makbuz: c.req.query('makbuz') ?? '',
    })),
  );
  api.post('/reservations/:id/message-log', async (c) => {
    const body = await c.req.json<{ channel: 'whatsapp' | 'sms'; body: string }>();
    settings.logMessage(db, { reservation_id: c.req.param('id'), ...body }, c.get('user').id);
    return c.json({ ok: true }, 201);
  });

  // --- Müşteriler ---
  api.get('/customers', (c) => c.json(customers.listCustomers(db, c.req.query('q'))));
  api.get('/customers/:id', (c) => c.json(customers.getCustomer(db, c.req.param('id'))));
  api.put('/customers/:id', async (c) => {
    const u = role(c, 'resepsiyon');
    return c.json(customers.updateCustomer(db, c.req.param('id'), await c.req.json(), u.id));
  });
  api.post('/customer-notes', async (c) => {
    const u = role(c, 'resepsiyon', 'muhasebe');
    return c.json({ id: customers.addNote(db, await c.req.json(), u.id) }, 201);
  });

  // --- Menü / hizmet / paket ---
  api.get('/services', (c) => c.json(services.listServices(db, c.req.query('all') === '1')));
  api.post('/services', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(services.saveService(db, null, await c.req.json(), u.id), 201);
  });
  api.put('/services/:id', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(services.saveService(db, c.req.param('id'), await c.req.json(), u.id));
  });

  // --- Personel ---
  api.get('/staff', (c) => c.json(staff.listStaff(db, c.req.query('all') === '1')));
  api.get('/staff/:id/schedule', (c) => c.json(staff.staffSchedule(db, c.req.param('id'))));
  api.post('/staff', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(staff.saveStaff(db, null, await c.req.json(), u.id), 201);
  });
  api.put('/staff/:id', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(staff.saveStaff(db, c.req.param('id'), await c.req.json(), u.id));
  });

  // --- Gelir / gider ---
  api.get('/finance/categories', (c) => c.json({ gider: finance.EXPENSE_CATEGORIES, gelir: finance.INCOME_CATEGORIES }));
  api.get('/finance/entries', (c) => {
    role(c, 'muhasebe');
    return c.json(finance.listEntries(db, c.req.query('from') ?? '', c.req.query('to') ?? ''));
  });
  api.post('/finance/entries', async (c) => {
    const u = role(c, 'muhasebe');
    return c.json(finance.addEntry(db, await c.req.json(), u.id), 201);
  });
  api.delete('/finance/entries/:id', (c) => {
    const u = role(c, 'muhasebe');
    finance.deleteEntry(db, c.req.param('id'), u.id);
    return c.json({ ok: true });
  });
  api.get('/finance/summary', (c) => {
    role(c, 'muhasebe');
    return c.json(finance.financeSummary(db, c.req.query('from') ?? '', c.req.query('to') ?? ''));
  });

  // --- Ana sayfa, ayarlar ---
  api.get('/dashboard', (c) => c.json(dashboard(db, c.req.query('today') ?? undefined)));
  api.post('/admin/reset-data', async (c) => {
    const u = role(c, 'admin');
    const local = await resetTestData(db, await c.req.json(), u, config.dbPath);
    let cloud: string = 'kapalı';
    if (sync?.enabled) {
      try {
        await sync.resetCloud();
        cloud = 'temizlendi';
      } catch (err) {
        cloud = `temizlenemedi: ${(err as Error).message}`;
      }
    }
    return c.json({ ...local, cloud });
  });
  api.get('/settings', (c) => c.json(settings.getSettings(db)));
  api.put('/settings', async (c) => {
    const u = role(c, 'admin');
    return c.json(settings.saveSettings(db, await c.req.json(), u.id));
  });
  api.get('/message-templates', (c) => c.json(settings.listTemplates(db)));
  api.put('/message-templates/:key', async (c) => {
    const u = role(c, 'admin');
    const body = await c.req.json<{ body: string }>();
    return c.json(settings.saveTemplate(db, c.req.param('key'), body.body, u.id));
  });

  // --- Raporlar ve senkronizasyon ---
  api.get('/reports/yearly', async (c) => {
    role(c, 'muhasebe');
    return c.json(await yearlyReport(db, c.req.query('year') ?? new Date().toISOString().slice(0, 4)));
  });
  api.get('/reports/daily', (c) => {
    role(c, 'muhasebe', 'kasiyer');
    return c.json(dailySummary(db, c.req.query('date') ?? new Date().toISOString().slice(0, 10)));
  });
  api.get('/sync/status', (c) => c.json(sync?.status() ?? { enabled: false }));
  api.post('/sync/run', async (c) => {
    role(c, 'admin');
    return c.json(sync ? await sync.runOnce() : { pushed: 0, pulled: 0 });
  });

  app.route('/api', api);
  return app;
}
