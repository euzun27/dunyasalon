import { lineTotal, ValidationError, type PaymentInput } from '@dunyatek/shared';

export interface PricedLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price_kurus: number;
  vat_rate: number;
}

export interface SaleTotals {
  lines: Array<PricedLine & { line_total_kurus: number }>;
  subtotal_kurus: number;
  discount_kurus: number;
  total_kurus: number;
  vat_kurus: number;
}

export function computeSaleTotals(lines: PricedLine[], discountKurus = 0): SaleTotals {
  if (lines.length === 0) throw new ValidationError('Sepet boş');
  if (!Number.isInteger(discountKurus) || discountKurus < 0) throw new ValidationError('İndirim geçersiz');
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new ValidationError(`${l.name}: miktar geçersiz`);
    return { ...l, line_total_kurus: lineTotal(l.unit_price_kurus, l.qty) };
  });
  const subtotal = priced.reduce((s, l) => s + l.line_total_kurus, 0);
  if (discountKurus > subtotal) throw new ValidationError('İndirim satış tutarını aşamaz');
  const total = subtotal - discountKurus;
  // Fiyatlar KDV dahildir; KDV payı indirim oranında dağıtılarak hesaplanır.
  const ratio = subtotal === 0 ? 0 : total / subtotal;
  const vat = priced.reduce((s, l) => {
    const gross = l.line_total_kurus * ratio;
    return s + gross - gross / (1 + l.vat_rate / 100);
  }, 0);
  return {
    lines: priced,
    subtotal_kurus: subtotal,
    discount_kurus: discountKurus,
    total_kurus: total,
    vat_kurus: Math.round(vat),
  };
}

export function validatePayments(
  totalKurus: number,
  payments: PaymentInput[],
  eventAccountId: string | null | undefined,
): void {
  if (payments.length === 0) throw new ValidationError('Ödeme bilgisi yok');
  let sum = 0;
  for (const p of payments) {
    if (!['nakit', 'kart', 'dugun_hesabi'].includes(p.method)) {
      throw new ValidationError(`Geçersiz ödeme yöntemi: ${p.method}`);
    }
    if (!Number.isInteger(p.amount_kurus) || p.amount_kurus <= 0) {
      throw new ValidationError('Ödeme tutarı pozitif tamsayı (kuruş) olmalıdır');
    }
    if (p.method === 'dugun_hesabi' && !eventAccountId) {
      throw new ValidationError('Düğün hesabına yazmak için organizasyon hesabı seçilmelidir');
    }
    sum += p.amount_kurus;
  }
  if (sum !== totalKurus) {
    throw new ValidationError(`Ödeme toplamı (${sum}) satış tutarına (${totalKurus}) eşit olmalıdır`);
  }
}

/** Nakit ödemede para üstü hesabı (yalnızca arayüz için; kayda net tutar yazılır). */
export function changeDue(totalKurus: number, receivedKurus: number): number {
  return Math.max(0, receivedKurus - totalKurus);
}
