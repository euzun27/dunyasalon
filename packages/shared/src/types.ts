export type Role = 'admin' | 'kasiyer' | 'resepsiyon' | 'muhasebe';

export type PaymentMethod = 'nakit' | 'kart' | 'dugun_hesabi';

export type SaleStatus = 'tamamlandi' | 'iade';

export type ReservationStatus = 'talep' | 'opsiyon' | 'kesin' | 'iptal' | 'tamamlandi';

export type StockMovementType = 'giris' | 'satis' | 'iade' | 'sayim' | 'fire';

export type LedgerEntryType = 'borc' | 'alacak';

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: string | null;
  unit: string;
  price_kurus: number;
  vat_rate: number;
  track_stock: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CartLineInput {
  product_id?: string;
  barcode?: string;
  qty: number; // ölçekli miktar (QTY_SCALE)
}

export interface PaymentInput {
  method: PaymentMethod;
  amount_kurus: number;
}

export interface SaleInput {
  id?: string; // istemci tarafında üretilirse tekrar gönderimde çift satış olmaz
  lines: CartLineInput[];
  payments: PaymentInput[];
  event_account_id?: string | null;
  discount_kurus?: number;
  note?: string | null;
}

export interface ReservationInput {
  id?: string;
  hall_id: string;
  customer_name: string;
  customer_phone?: string | null;
  event_type?: string;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  guest_count?: number;
  price_kurus?: number;
  deposit_kurus?: number;
  status?: ReservationStatus;
  notes?: string | null;
}
