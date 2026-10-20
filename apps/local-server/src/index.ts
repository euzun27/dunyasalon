import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './database/db.ts';
import { SyncEngine } from './sync/engine.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const sync = new SyncEngine(db, {
  deviceId: config.deviceId,
  cloudUrl: config.cloudUrl,
  cloudToken: config.cloudToken,
  reservationBufferMinutes: config.reservationBufferMinutes,
});
const app = createApp(db, config, sync);

// Derlenmiş web arayüzü (apps/web/dist) yerel sunucudan servis edilir; kasalar internetsiz çalışır.
if (existsSync(config.webDist)) {
  const root = relative(process.cwd(), config.webDist) || '.';
  app.use('/*', serveStatic({ root }));
  const indexHtml = readFileSync(join(config.webDist, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(indexHtml));
} else {
  console.warn(`Web arayüzü bulunamadı (${config.webDist}). "npm run build -w @dunyatek/web" çalıştırın.`);
}

sync.start(config.syncIntervalMs);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`DUNYATEK yerel sunucu: http://${info.address}:${info.port} · veritabanı ${config.dbPath}`);
  console.log(sync.enabled ? `Senkronizasyon açık → ${config.cloudUrl}` : 'Senkronizasyon kapalı (CLOUD_URL/CLOUD_TOKEN yok)');
});

function shutdown() {
  console.log('Kapatılıyor...');
  sync.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
