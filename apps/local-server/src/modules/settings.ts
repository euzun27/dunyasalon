import { renderTemplate, toWhatsAppNumber } from '@dunyatek/business-rules';
import { formatTL, newId, nowIso, NotFoundError, ValidationError, requireString } from '@dunyatek/shared';
import { all, run, setSetting, tx, type DB } from '../database/db.ts';
import { audit } from '../database/outbox.ts';
import { reservationDetail } from './reservation-details.ts';

const EDITABLE = ['business.name', 'business.phone', 'business.address', 'business.tax', 'contract.terms'];

export function getSettings(db: DB): Record<string, string> {
  return Object.fromEntries(all<{ key: string; value: string }>(db, "SELECT key, value FROM settings WHERE key LIKE 'business.%' OR key LIKE 'contract.%'").map((r) => [r.key, r.value]));
}

export function saveSettings(db: DB, input: Record<string, unknown>, userId: string | null) {
  tx(db, () => {
    for (const [k, v] of Object.entries(input)) {
      if (!EDITABLE.includes(k)) continue;
      setSetting(db, k, typeof v === 'string' ? v.slice(0, 10_000) : '');
    }
    audit(db, userId, 'settings.save', 'settings', null, Object.keys(input));
  });
  return getSettings(db);
}

export function listTemplates(db: DB) {
  return all<{ key: string; title: string; body: string }>(db, 'SELECT * FROM message_templates ORDER BY title');
}

export function saveTemplate(db: DB, key: string, body: string, userId: string | null) {
  const text = requireString(body, 'Mesaj', 1000);
  const res = run(db, 'UPDATE message_templates SET body = ? WHERE key = ?', text, key);
  if (res.changes === 0) throw new NotFoundError('Şablon bulunamadı');
  audit(db, userId, 'template.save', 'message_template', key);
  return listTemplates(db);
}

const EVENT_TYPES: Record<string, string> = { dugun: 'düğün', nisan: 'nişan', kina: 'kına', sunnet: 'sünnet', diger: 'organizasyon' };

function dateTR(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

/** Rezervasyon için şablonu doldurur ve WhatsApp bağlantısını üretir. */
export function composeMessage(db: DB, reservationId: string, templateKey: string, extra: Record<string, string> = {}) {
  const tpl = listTemplates(db).find((t) => t.key === templateKey);
  if (!tpl) throw new NotFoundError('Şablon bulunamadı');
  const d = reservationDetail(db, reservationId);
  const s = getSettings(db);
  const r = d.reservation;
  const text = renderTemplate(tpl.body, {
    musteri: r.customer_name,
    tarih: dateTR(r.event_date),
    saat: `${r.start_time}-${r.end_time}`,
    salon: r.hall_name,
    etkinlik: EVENT_TYPES[r.event_type] ?? r.event_type,
    toplam: formatTL(d.money.total_kurus),
    odenen: formatTL(d.money.paid_kurus),
    kalan: formatTL(d.money.balance_kurus),
    opsiyon_bitis: dateTR(r.option_until),
    isletme: s['business.name'] ?? '',
    isletme_tel: s['business.phone'] ?? '',
    ...extra,
  });
  const phone = toWhatsAppNumber(r.customer_phone);
  return {
    text,
    phone: r.customer_phone,
    whatsapp_url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
    sms_url: r.customer_phone ? `sms:${r.customer_phone}?body=${encodeURIComponent(text)}` : null,
  };
}

export function logMessage(
  db: DB,
  input: { reservation_id: string; channel: 'whatsapp' | 'sms'; body: string },
  userId: string | null,
) {
  if (!['whatsapp', 'sms'].includes(input.channel)) throw new ValidationError('Geçersiz kanal');
  const d = reservationDetail(db, input.reservation_id);
  if (!d.reservation.customer_phone) throw new ValidationError('Müşterinin telefonu kayıtlı değil');
  run(
    db,
    'INSERT INTO message_log (id, customer_id, reservation_id, channel, phone, body, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), d.reservation.customer_id, input.reservation_id, input.channel, d.reservation.customer_phone,
    requireString(input.body, 'Mesaj', 2000), userId, nowIso(),
  );
}
