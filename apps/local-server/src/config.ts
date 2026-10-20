import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  deviceId: string;
  cloudUrl: string | null;
  cloudToken: string | null;
  webDist: string;
  syncIntervalMs: number;
  reservationBufferMinutes: number;
  sessionHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: resolve(env.DB_PATH ?? 'data/wedding.db'),
    deviceId: env.DEVICE_ID ?? 'salon-mini-pc-1',
    cloudUrl: env.CLOUD_URL || null,
    cloudToken: env.CLOUD_TOKEN || null,
    webDist: resolve(env.WEB_DIST ?? '../web/dist'),
    syncIntervalMs: Number(env.SYNC_INTERVAL_MS ?? 15_000),
    reservationBufferMinutes: Number(env.RESERVATION_BUFFER_MINUTES ?? 60),
    sessionHours: Number(env.SESSION_HOURS ?? 12),
  };
}
