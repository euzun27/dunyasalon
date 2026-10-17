/**
 * Yerel sunucu ↔ Cloudflare Worker senkronizasyon protokolü.
 *
 * - Yerel sunucu her iş işlemini (satış, stok hareketi, rezervasyon değişikliği)
 *   aynı SQLite transaction'ı içinde sync_outbox'a bir olay olarak yazar.
 * - Olaylar /api/sync/push ile sırayla gönderilir; bulut event_id üzerinden
 *   tekilleştirir, yani aynı olay iki kez gelse de bir kez işlenir.
 * - Bulutta oluşan değişiklikler (ör. uzaktan rezervasyon talebi) /api/sync/pull
 *   ile cursor üzerinden alınır, sync_inbox'a yazılıp yerelde onaylanır.
 */

export const PROTOCOL_VERSION = 1;

export type SyncEventType =
  | 'hall.upserted'
  | 'customer.upserted'
  | 'product.upserted'
  | 'stock.moved'
  | 'sale.completed'
  | 'sale.refunded'
  | 'event_account.upserted'
  | 'event_ledger.posted'
  | 'reservation.upserted'
  | 'reservation_request.created';

export interface SyncEvent<T = unknown> {
  event_id: string; // UUIDv7, küresel olarak benzersiz
  type: SyncEventType;
  aggregate_id: string;
  payload: T;
  occurred_at: string; // ISO
  origin: string; // cihaz kimliği (ör. "salon-mini-pc-1" veya "cloud")
  seq?: number; // kaynak sistemdeki sıra numarası
}

export interface PushRequest {
  protocol: number;
  device_id: string;
  events: SyncEvent[];
}

export interface PushResult {
  accepted: string[]; // yeni işlenen olaylar
  duplicates: string[]; // daha önce işlenmiş, yok sayılan olaylar
  rejected: Array<{ event_id: string; error: string }>;
}

export interface PullResponse {
  events: Array<SyncEvent & { cursor: number }>;
  next_cursor: number;
  has_more: boolean;
}

export const MAX_PUSH_BATCH = 50;

/** Basit üstel geri çekilme: 5 sn, 10 sn, 20 sn ... en fazla 10 dk. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

export function isSyncEvent(v: unknown): v is SyncEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.event_id === 'string' &&
    typeof e.type === 'string' &&
    typeof e.aggregate_id === 'string' &&
    typeof e.occurred_at === 'string' &&
    typeof e.origin === 'string' &&
    'payload' in e
  );
}
