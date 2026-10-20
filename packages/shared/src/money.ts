/**
 * Tüm parasal tutarlar tamsayı kuruş olarak tutulur (1 TL = 100 kuruş).
 * Miktarlar QTY_SCALE ile ölçeklenmiş tamsayıdır (1 adet = 1000).
 */
export const QTY_SCALE = 1000;

export function toKurus(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Geçersiz tutar');
    return Math.round(input * 100);
  }
  const s = input.trim().replace(/\s|₺|TL/gi, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+([.,]\d{1,2})?$/.test(s)) {
    throw new Error(`Geçersiz tutar: ${input}`);
  }
  // "1.250,50" ve "150.000" (TR) ile "1250.50" biçimlerini kabul et
  const thousandsOnly = /^-?\d{1,3}(\.\d{3})+$/.test(s);
  const normalized = s.includes(',') || thousandsOnly ? s.replace(/\./g, '').replace(',', '.') : s;
  return Math.round(Number(normalized) * 100);
}

export function formatTL(kurus: number): string {
  const sign = kurus < 0 ? '-' : '';
  const abs = Math.abs(kurus);
  const lira = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const k = (abs % 100).toString().padStart(2, '0');
  return `${sign}${lira},${k} ₺`;
}

export function toQty(units: number): number {
  return Math.round(units * QTY_SCALE);
}

export function fromQty(qty: number): number {
  return qty / QTY_SCALE;
}

/** Birim fiyat (kuruş) × ölçekli miktar → satır tutarı (kuruş). */
export function lineTotal(unitPriceKurus: number, qty: number): number {
  return Math.round((unitPriceKurus * qty) / QTY_SCALE);
}
