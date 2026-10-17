import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWhatsAppNumber } from '@dunyatek/business-rules';
import { createReservation } from '../../apps/local-server/src/modules/reservations.ts';
import { saveService } from '../../apps/local-server/src/modules/services.ts';
import {
  addInstallment,
  addItem,
  addPayment,
  assignStaff,
  cancelPayment,
  removeItem,
  reservationDetail,
  updateItemQty,
} from '../../apps/local-server/src/modules/reservation-details.ts';
import { saveStaff } from '../../apps/local-server/src/modules/staff.ts';
import { addEntry, financeSummary } from '../../apps/local-server/src/modules/finance.ts';
import { dashboard } from '../../apps/local-server/src/modules/dashboard.ts';
import { composeMessage } from '../../apps/local-server/src/modules/settings.ts';
import { getCustomer, addNote } from '../../apps/local-server/src/modules/customers.ts';
import { freshDb, seed } from '../helpers/setup.ts';

function setup() {
  const db = freshDb();
  const s = seed(db);
  const ctx = { userId: s.admin.id, bufferMinutes: 60 };
  const r = createReservation(
    db,
    {
      hall_id: s.hall.id,
      customer_name: 'Ayşe Yılmaz',
      customer_phone: '0532 111 22 33',
      event_date: '2027-06-12',
      start_time: '19:00',
      end_time: '00:00',
      guest_count: 300,
      price_kurus: 5_000_000,
      discount_kurus: 500_000,
      status: 'kesin',
    },
    ctx,
  );
  return { db, ...s, r };
}

test('menü kişi başı, hizmet sabit fiyatla rezervasyon toplamına eklenir', () => {
  const { db, admin, r } = setup();
  const menu = saveService(db, null, { name: 'Akşam yemeği menüsü', kind: 'menu', pricing: 'kisi_basi', price_kurus: 45_000 }, admin.id);
  const pasta = saveService(db, null, { name: 'Düğün pastası', kind: 'hizmet', pricing: 'sabit', price_kurus: 800_000 }, admin.id);
  const m = addItem(db, r.id, { service_id: menu.id }, admin.id);
  assert.equal(m.qty, 300); // davetli sayısı
  assert.equal(m.total_kurus, 13_500_000);
  const p = addItem(db, r.id, { service_id: pasta.id }, admin.id);
  let d = reservationDetail(db, r.id);
  assert.equal(d.money.total_kurus, 5_000_000 - 500_000 + 13_500_000 + 800_000);
  updateItemQty(db, m.id, 280, admin.id);
  removeItem(db, p.id, admin.id);
  d = reservationDetail(db, r.id);
  assert.equal(d.money.total_kurus, 5_000_000 - 500_000 + 280 * 45_000);
  assert.equal(d.items.length, 1);
});

test('kapora ve ara ödeme bakiyeyi düşürür; iptal edilen tahsilat sayılmaz; makbuz numarası artar', () => {
  const { db, admin, r } = setup();
  const k = addPayment(db, r.id, { kind: 'kapora', method: 'nakit', amount_kurus: 1_000_000 }, admin.id);
  const a = addPayment(db, r.id, { kind: 'ara_odeme', method: 'havale', amount_kurus: 2_000_000 }, admin.id);
  assert.equal(a.receipt_no, k.receipt_no + 1);
  assert.equal(reservationDetail(db, r.id).money.balance_kurus, 4_500_000 - 3_000_000);
  cancelPayment(db, a.id, 'Yanlış tutar girildi', admin.id);
  assert.equal(reservationDetail(db, r.id).money.paid_kurus, 1_000_000);
  assert.throws(() => cancelPayment(db, a.id, 'tekrar', admin.id), /zaten iptal/);
  assert.throws(() => addPayment(db, r.id, { kind: 'iade', method: 'nakit', amount_kurus: 2_000_000 }, admin.id), /İade tutarı/);
});

test('ana sayfa gecikmiş vadeyi ve yaklaşan etkinliğin açık bakiyesini hatırlatır', () => {
  const { db, admin, r } = setup();
  addInstallment(db, r.id, { due_date: '2027-05-01', amount_kurus: 2_000_000 }, admin.id);
  const d = dashboard(db, '2027-06-08');
  const kinds = d.reminders.filter((x) => x.reservation_id === r.id).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['bakiye', 'vade']);
  assert.equal(d.kpis.receivable_kurus, 4_500_000);
  assert.equal(d.upcoming.length, 1);
});

test('opsiyon bitiş tarihi yaklaşınca hatırlatma çıkar', () => {
  const { db, admin, hall } = setup();
  createReservation(
    db,
    { hall_id: hall.id, customer_name: 'Opsiyonlu', customer_phone: '05440000000', event_date: '2027-08-01', start_time: '19:00', end_time: '23:00', status: 'opsiyon', option_until: '2027-06-10' },
    { userId: admin.id, bufferMinutes: 60 },
  );
  const d = dashboard(db, '2027-06-09');
  assert.ok(d.reminders.some((x) => x.kind === 'opsiyon' && x.level === 'warn'));
});

test('dönem özeti: tahsilat + diğer gelir − gider − personel yevmiyesi', () => {
  const { db, admin, r } = setup();
  const st = saveStaff(db, null, { full_name: 'Mehmet Garson', daily_wage_kurus: 150_000 }, admin.id);
  assignStaff(db, r.id, { staff_id: st.id, task: 'Servis' }, admin.id);
  addPayment(db, r.id, { kind: 'kapora', method: 'nakit', amount_kurus: 1_000_000 }, admin.id);
  addEntry(db, { type: 'gider', category: 'Mutfak / gıda', amount_kurus: 300_000, entry_date: '2027-06-12', reservation_id: r.id }, admin.id);
  addEntry(db, { type: 'gelir', category: 'Fotoğraf / video', amount_kurus: 200_000, entry_date: '2027-06-12' }, admin.id);
  const today = new Date().toISOString().slice(0, 10);
  const s = financeSummary(db, '2027-06-01', '2027-06-30');
  assert.equal(s.staff_wages_kurus, 150_000);
  assert.equal(s.other_expense_kurus, 300_000);
  assert.equal(s.other_income_kurus, 200_000);
  const now = financeSummary(db, today.slice(0, 8) + '01', today);
  assert.equal(now.reservation_income_kurus, 1_000_000);
  const d = reservationDetail(db, r.id);
  assert.equal(d.money.net_kurus, 4_500_000 - 150_000 - 300_000);
});

test('mesaj şablonu doldurulur ve WhatsApp bağlantısı üretilir', () => {
  const { db, r } = setup();
  const m = composeMessage(db, r.id, 'rezervasyon_onay');
  assert.match(m.text, /Sayın Ayşe Yılmaz, 12\.06\.2027 tarihli düğün/);
  assert.match(m.text, /Toplam: 45\.000,00 ₺/);
  assert.ok(m.whatsapp_url?.startsWith('https://wa.me/905321112233?text='));
  assert.equal(toWhatsAppNumber('5321112233'), '905321112233');
  assert.equal(toWhatsAppNumber('+90 (532) 111 22 33'), '905321112233');
});

test('müşteri kartı rezervasyon geçmişini, bakiyeyi ve görüşme notlarını gösterir', () => {
  const { db, admin, r } = setup();
  addNote(db, { customer_id: r.customer_id, note: 'Menü tadımı için cumartesi gelecek' }, admin.id);
  const c = getCustomer(db, r.customer_id) as { reservations: unknown[]; notes: unknown[]; balance_kurus: number };
  assert.equal(c.reservations.length, 1);
  assert.equal(c.notes.length, 1);
  assert.equal(c.balance_kurus, 4_500_000);
});
