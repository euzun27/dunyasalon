import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsOverlap } from '@dunyatek/business-rules';
import {
  createReservation,
  setReservationStatus,
  updateReservation,
  checkAvailability,
  createHall,
  updateHall,
} from '../../apps/local-server/src/modules/reservations.ts';
import { one } from '../../apps/local-server/src/database/db.ts';
import { listEventAccounts } from '../../apps/local-server/src/modules/event-accounts.ts';
import { freshDb, seed } from '../helpers/setup.ts';

const base = { customer_name: 'Ayşe Yılmaz', customer_phone: '05551112233', event_date: '2027-06-12', start_time: '19:00', end_time: '00:00' };

test('gece yarısını geçen etkinlikler doğru çakışır', () => {
  assert.equal(slotsOverlap({ event_date: '2027-06-12', start_time: '19:00', end_time: '01:00' }, { event_date: '2027-06-13', start_time: '00:30', end_time: '03:00' }), true);
  assert.equal(slotsOverlap({ event_date: '2027-06-12', start_time: '12:00', end_time: '16:00' }, { event_date: '2027-06-12', start_time: '19:00', end_time: '23:00' }), false);
  assert.equal(slotsOverlap({ event_date: '2027-06-12', start_time: '12:00', end_time: '18:30' }, { event_date: '2027-06-12', start_time: '19:00', end_time: '23:00' }, 60), true);
});

test('aynı salon ve saate ikinci rezervasyon engellenir', () => {
  const db = freshDb();
  const { admin, hall } = seed(db);
  const ctx = { userId: admin.id, bufferMinutes: 60 };
  createReservation(db, { ...base, hall_id: hall.id, status: 'kesin' }, ctx);
  assert.throws(
    () => createReservation(db, { ...base, hall_id: hall.id, customer_name: 'Zeynep', customer_phone: '05550000000', start_time: '20:00', end_time: '23:30' }, ctx),
    /Salon dolu/,
  );
  // Talep salonu kilitlemez
  const req = createReservation(db, { ...base, hall_id: hall.id, customer_name: 'Talep', customer_phone: null, status: 'talep' }, ctx);
  assert.equal(req.status, 'talep');
  assert.throws(() => setReservationStatus(db, req.id, 'kesin', ctx), /Salon dolu/);
  // Öğleden sonra (temizlik payı dahil) uygun
  const avail = checkAvailability(db, { hall_id: hall.id, event_date: '2027-06-12', start_time: '11:00', end_time: '17:00' }, 60);
  assert.equal(avail.available, true);
});

test('kesinleşen rezervasyona düğün hesabı otomatik açılır', () => {
  const db = freshDb();
  const { admin, hall } = seed(db);
  const ctx = { userId: admin.id, bufferMinutes: 60 };
  const r = createReservation(db, { ...base, hall_id: hall.id, status: 'opsiyon' }, ctx);
  assert.equal(r.event_account_id, null);
  const k = setReservationStatus(db, r.id, 'kesin', ctx);
  assert.ok(k.event_account_id);
  assert.equal(listEventAccounts(db).length, 1);
  setReservationStatus(db, r.id, 'kesin', ctx);
  assert.equal(listEventAccounts(db).length, 1);
});

test('eşzamanlı düzenlemede eski sürüm reddedilir (iyimser kilit)', () => {
  const db = freshDb();
  const { admin, hall } = seed(db);
  const ctx = { userId: admin.id, bufferMinutes: 60 };
  const r = createReservation(db, { ...base, hall_id: hall.id }, ctx);
  updateReservation(db, r.id, { ...base, hall_id: hall.id, guest_count: 300, version: r.version }, ctx);
  assert.throws(() => updateReservation(db, r.id, { ...base, hall_id: hall.id, guest_count: 400, version: r.version }, ctx), /başka bir kullanıcı/);
});

test('iptal edilen rezervasyonun saati yeniden kullanılabilir', () => {
  const db = freshDb();
  const { admin, hall } = seed(db);
  const ctx = { userId: admin.id, bufferMinutes: 60 };
  const r = createReservation(db, { ...base, hall_id: hall.id, status: 'kesin' }, ctx);
  setReservationStatus(db, r.id, 'iptal', ctx);
  const again = createReservation(db, { ...base, hall_id: hall.id, customer_name: 'Yeni', customer_phone: '05559998877', status: 'kesin' }, ctx);
  assert.equal(again.status, 'kesin');
});

test('salon adı, kapasitesi ve durumu düzenlenir, eşitlemeye gider', () => {
  const db = freshDb();
  const { admin, hall } = seed(db);
  const other = createHall(db, { name: 'Bahçe', capacity: 300 }, admin.id);
  const updated = updateHall(db, hall.id, { name: 'Kristal Salon', capacity: 750, active: false }, admin.id);
  assert.equal(updated.name, 'Kristal Salon');
  assert.equal(updated.capacity, 750);
  assert.equal(updated.active, 0);
  assert.throws(() => updateHall(db, other.id, { name: 'Kristal Salon' }, admin.id), /Bu isimde salon var/);
  const ev = one<{ payload: string }>(db, "SELECT payload FROM sync_outbox WHERE type = 'hall.upserted' ORDER BY seq DESC LIMIT 1");
  assert.equal(JSON.parse(ev!.payload).name, 'Kristal Salon');
});
