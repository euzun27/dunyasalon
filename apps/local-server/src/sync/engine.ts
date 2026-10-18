import {
  MAX_PUSH_BATCH,
  PROTOCOL_VERSION,
  retryDelayMs,
  type PullResponse,
  type PushRequest,
  type PushResult,
  type SyncEvent,
  type SyncEventType,
} from '@dunyatek/sync-protocol';
import { nowIso, type ReservationInput } from '@dunyatek/shared';
import { all, getSetting, one, run, setSetting, tx, type DB } from '../database/db.ts';
import { createReservation } from '../modules/reservations.ts';

export interface SyncOptions {
  deviceId: string;
  cloudUrl: string | null;
  cloudToken: string | null;
  reservationBufferMinutes: number;
  fetch?: typeof fetch;
}

interface OutboxRow {
  seq: number;
  event_id: string;
  type: SyncEventType;
  aggregate_id: string;
  payload: string;
  occurred_at: string;
  attempts: number;
}

export interface SyncStatus {
  enabled: boolean;
  pending: number;
  failed: number;
  sent: number;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_error: string | null;
  online: boolean;
}

export class SyncEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private online = false;
  private lastError: string | null = null;

  constructor(private db: DB, private opts: SyncOptions) {}

  get enabled(): boolean {
    return Boolean(this.opts.cloudUrl && this.opts.cloudToken);
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.opts.cloudUrl!.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.cloudToken}`,
        'x-device-id': this.opts.deviceId,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Bulut yanıtı ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** Bekleyen olayları sırayla buluta gönderir. Gönderilen olay sayısını döner. */
  async pushOnce(): Promise<number> {
    if (!this.enabled) return 0;
    const now = nowIso();
    const rows = all<OutboxRow>(
      this.db,
      `SELECT seq, event_id, type, aggregate_id, payload, occurred_at, attempts FROM sync_outbox
        WHERE status IN ('bekliyor', 'hata') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY seq LIMIT ${MAX_PUSH_BATCH}`,
      now,
    );
    if (rows.length === 0) return 0;
    const body: PushRequest = {
      protocol: PROTOCOL_VERSION,
      device_id: this.opts.deviceId,
      events: rows.map<SyncEvent>((r) => ({
        event_id: r.event_id,
        type: r.type,
        aggregate_id: r.aggregate_id,
        payload: JSON.parse(r.payload),
        occurred_at: r.occurred_at,
        origin: this.opts.deviceId,
        seq: r.seq,
      })),
    };
    let result: PushResult;
    try {
      result = await this.call<PushResult>('/api/sync/push', { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      // Bağlantı yok: olaylar kuyrukta güvenle bekler, geri çekilmeyle tekrar denenir.
      this.markFailed(rows, String((err as Error).message ?? err));
      throw err;
    }
    const ok = new Set([...result.accepted, ...result.duplicates]);
    const rejected = new Map(result.rejected.map((r) => [r.event_id, r.error]));
    tx(this.db, () => {
      for (const r of rows) {
        if (ok.has(r.event_id)) {
          run(this.db, "UPDATE sync_outbox SET status = 'gonderildi', sent_at = ?, last_error = NULL WHERE seq = ?", now, r.seq);
        } else {
          this.markRowFailed(r, rejected.get(r.event_id) ?? 'Bulut yanıtında yok');
        }
      }
      setSetting(this.db, 'sync.last_push_at', now);
    });
    return ok.size;
  }

  private markFailed(rows: OutboxRow[], error: string) {
    tx(this.db, () => rows.forEach((r) => this.markRowFailed(r, error)));
  }

  private markRowFailed(r: OutboxRow, error: string) {
    const attempts = r.attempts + 1;
    const next = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
    run(this.db, "UPDATE sync_outbox SET status = 'hata', attempts = ?, last_error = ?, next_attempt_at = ? WHERE seq = ?",
      attempts, error.slice(0, 500), next, r.seq);
  }

  /** Buluttaki yeni olayları (ör. uzaktan rezervasyon talepleri) alır ve yerelde işler. */
  async pullOnce(): Promise<number> {
    if (!this.enabled) return 0;
    let total = 0;
    for (let page = 0; page < 20; page++) {
      const cursor = one<{ cursor: number }>(this.db, "SELECT cursor FROM sync_cursors WHERE name = 'cloud'")?.cursor ?? 0;
      const res = await this.call<PullResponse>(`/api/sync/pull?cursor=${cursor}&limit=100`);
      tx(this.db, () => {
        for (const e of res.events) {
          const inserted = run(
            this.db,
            `INSERT INTO sync_inbox (event_id, type, aggregate_id, payload, received_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(event_id) DO NOTHING`,
            e.event_id, e.type, e.aggregate_id, JSON.stringify(e.payload), nowIso(),
          );
          if (inserted.changes > 0) this.processInbox(e);
        }
        run(
          this.db,
          `INSERT INTO sync_cursors (name, cursor, updated_at) VALUES ('cloud', ?, ?)
           ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
          res.next_cursor, nowIso(),
        );
        setSetting(this.db, 'sync.last_pull_at', nowIso());
      });
      total += res.events.length;
      if (!res.has_more) break;
    }
    return total;
  }

  private processInbox(e: SyncEvent) {
    try {
      if (e.type === 'reservation_request.created') {
        // Uzaktan gelen talep salonu kilitlemez; resepsiyon yerelde kesinleştirir.
        const p = e.payload as ReservationInput;
        createReservation(
          this.db,
          { ...p, id: e.aggregate_id, status: 'talep' },
          { userId: null, bufferMinutes: this.opts.reservationBufferMinutes, source: 'bulut' },
        );
      }
      run(this.db, "UPDATE sync_inbox SET status = 'islendi', processed_at = ? WHERE event_id = ?", nowIso(), e.event_id);
    } catch (err) {
      run(this.db, "UPDATE sync_inbox SET status = 'reddedildi', processed_at = ?, error = ? WHERE event_id = ?",
        nowIso(), String((err as Error).message ?? err).slice(0, 500), e.event_id);
    }
  }

  async runOnce(): Promise<{ pushed: number; pulled: number }> {
    if (this.running || !this.enabled) return { pushed: 0, pulled: 0 };
    this.running = true;
    try {
      let pushed = 0;
      for (let i = 0; i < 20; i++) {
        const n = await this.pushOnce();
        pushed += n;
        if (n < MAX_PUSH_BATCH) break;
      }
      const pulled = await this.pullOnce();
      this.online = true;
      this.lastError = null;
      return { pushed, pulled };
    } catch (err) {
      this.online = false;
      this.lastError = String((err as Error).message ?? err);
      return { pushed: 0, pulled: 0 };
    } finally {
      this.running = false;
    }
  }

  /** Buluttaki test verilerini siler; süren bir eşitleme varsa bitmesini bekler. */
  async resetCloud(): Promise<void> {
    if (!this.enabled) throw new Error('Bulut bağlantısı tanımlı değil');
    while (this.running) await new Promise((r) => setTimeout(r, 200));
    this.running = true;
    try {
      await this.call('/api/sync/reset', { method: 'POST', body: '{}' });
    } finally {
      this.running = false;
    }
  }

  start(intervalMs: number) {
    if (!this.enabled || this.timer) return;
    const tick = () => void this.runOnce();
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): SyncStatus {
    const counts = Object.fromEntries(
      all<{ status: string; n: number }>(this.db, 'SELECT status, COUNT(*) AS n FROM sync_outbox GROUP BY status').map((r) => [r.status, r.n]),
    ) as Record<string, number>;
    return {
      enabled: this.enabled,
      pending: (counts.bekliyor ?? 0) + (counts.hata ?? 0),
      failed: counts.hata ?? 0,
      sent: counts.gonderildi ?? 0,
      last_push_at: getSetting(this.db, 'sync.last_push_at'),
      last_pull_at: getSetting(this.db, 'sync.last_pull_at'),
      last_error: this.lastError,
      online: this.online,
    };
  }
}
