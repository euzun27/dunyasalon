import { ValidationError } from '@dunyatek/shared';

export interface ReservationMoneyInput {
  price_kurus: number; // salon ücreti
  discount_kurus: number;
  items: Array<{ total_kurus: number }>;
  payments: Array<{ kind: string; amount_kurus: number; cancelled_at?: string | null }>;
}

export interface ReservationMoney {
  salon_kurus: number;
  items_kurus: number;
  discount_kurus: number;
  total_kurus: number;
  paid_kurus: number;
  balance_kurus: number;
}

/** Rezervasyon toplamı = salon ücreti + menü/hizmet kalemleri − indirim; bakiye = toplam − net tahsilat. */
export function reservationMoney(r: ReservationMoneyInput): ReservationMoney {
  const items = r.items.reduce((s, i) => s + i.total_kurus, 0);
  const total = r.price_kurus + items - r.discount_kurus;
  const paid = r.payments
    .filter((p) => !p.cancelled_at)
    .reduce((s, p) => s + (p.kind === 'iade' ? -p.amount_kurus : p.amount_kurus), 0);
  return {
    salon_kurus: r.price_kurus,
    items_kurus: items,
    discount_kurus: r.discount_kurus,
    total_kurus: total,
    paid_kurus: paid,
    balance_kurus: total - paid,
  };
}

/** Kişi başı fiyatlanan kalemde miktar davetli sayısıdır. */
export function itemTotal(pricing: 'sabit' | 'kisi_basi', qty: number, unitPriceKurus: number): number {
  if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('Miktar pozitif tamsayı olmalıdır');
  if (!Number.isInteger(unitPriceKurus) || unitPriceKurus < 0) throw new ValidationError('Birim fiyat geçersiz');
  return qty * unitPriceKurus;
}

/** Şablondaki {anahtar} alanlarını doldurur; bilinmeyen alan olduğu gibi kalır. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** Türk cep telefonunu WhatsApp için uluslararası biçime çevirir (0532... → 90532...). */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '90' + d.slice(1);
  else if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  return d.length >= 11 ? d : null;
}
