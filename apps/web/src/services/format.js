export const QTY_SCALE = 1000;

export function tl(kurus) {
  const n = Number(kurus ?? 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const lira = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${lira},${String(abs % 100).padStart(2, '0')} ₺`;
}

/** "12,50" | "12.50" | "1.250,50" → kuruş */
export function parseTL(text) {
  const s = String(text ?? '').trim().replace(/\s|₺|TL/gi, '');
  if (!s) return 0;
  // Türkçe yazım: virgül ondalık, nokta binlik ayraç ("150.000" = yüz elli bin)
  const thousandsOnly = /^-?\d{1,3}(\.\d{3})+$/.test(s);
  const normalized = s.includes(',') || thousandsOnly ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`Geçersiz tutar: ${text}`);
  return Math.round(n * 100);
}

export function qty(scaled) {
  const n = Number(scaled ?? 0) / QTY_SCALE;
  return Number.isInteger(n) ? String(n) : n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}

export function dateTR(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: iso.length === 10 ? 'short' : undefined });
}

export function dateTimeTR(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const STATUS_LABELS = {
  talep: 'Talep',
  opsiyon: 'Opsiyon',
  kesin: 'Kesin',
  iptal: 'İptal',
  tamamlandi: 'Tamamlandı',
};

export const METHOD_LABELS = { nakit: 'Nakit', kart: 'Kart', dugun_hesabi: 'Düğün hesabı' };

export const EVENT_TYPES = { dugun: 'Düğün', nisan: 'Nişan', kina: 'Kına', sunnet: 'Sünnet', diger: 'Diğer' };
export const PAYMENT_KINDS = { kapora: 'Kapora', ara_odeme: 'Ara ödeme', kalan: 'Kalan ödeme', iade: 'İade' };
export const PAY_METHODS = { nakit: 'Nakit', kart: 'Kredi kartı', havale: 'Havale / EFT' };
export const SERVICE_KINDS = { paket: 'Paket', menu: 'Menü', hizmet: 'Hizmet' };
export const PRICING = { sabit: 'Sabit fiyat', kisi_basi: 'Kişi başı' };

/** Kuruşu form alanına yazılacak "1250,50" biçimine çevirir (boşsa ''). */
export function toInput(kurus) {
  if (!kurus) return '';
  const s = (kurus / 100).toFixed(2).replace('.', ',');
  return s.endsWith(',00') ? s.slice(0, -3) : s;
}

export function dateShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function daysUntil(date) {
  const t = new Date(`${today()}T00:00:00`);
  return Math.round((new Date(`${date}T00:00:00`) - t) / 86400000);
}
