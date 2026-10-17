import { newId, nowIso } from '@dunyatek/shared';
import type { SyncEventType } from '@dunyatek/sync-protocol';
import { run, type DB } from './db.ts';

/** Çağıran transaction'ın içinde kullanılmalıdır: iş kaydı ve olay birlikte yazılır. */
export function enqueue(db: DB, type: SyncEventType, aggregateId: string, payload: unknown): string {
  const eventId = newId();
  run(
    db,
    'INSERT INTO sync_outbox (event_id, type, aggregate_id, payload, occurred_at) VALUES (?, ?, ?, ?, ?)',
    eventId,
    type,
    aggregateId,
    JSON.stringify(payload),
    nowIso(),
  );
  return eventId;
}

export function audit(
  db: DB,
  userId: string | null,
  action: string,
  entity: string | null,
  entityId: string | null,
  detail?: unknown,
): void {
  run(
    db,
    'INSERT INTO audit_logs (id, user_id, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    userId,
    action,
    entity,
    entityId,
    detail === undefined ? null : JSON.stringify(detail),
    nowIso(),
  );
}
