/**
 * Çalışan veritabanının tutarlı yedeği (SQLite çevrimiçi yedekleme API'si).
 * Aktif .db dosyası doğrudan kopyalanmaz.
 * Kullanım: BACKUP_DIR=C:\DUNYATEK\WeddingERP\backups npm run backup -w @dunyatek/local-server
 */
import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.ts';

const config = loadConfig();
const dir = resolve(process.env.BACKUP_DIR ?? 'backups');
const keep = Number(process.env.BACKUP_KEEP ?? 30);
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dir, `wedding-${stamp}.db`);
const source = new DatabaseSync(config.dbPath);
const pages = await backup(source, target);
source.close();

// Yedeği tek dosyaya indir (WAL kapatılır), sonra bütünlüğünü doğrula.
const check = new DatabaseSync(target);
check.exec('PRAGMA journal_mode = DELETE');
const integrity = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
check.close();
if (integrity !== 'ok') {
  console.error(`Yedek bütünlük kontrolünden geçmedi: ${integrity}`);
  process.exit(1);
}
console.log(`Yedek alındı: ${target} (${pages} sayfa)`);

const old = readdirSync(dir).filter((f) => /^wedding-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(join(dir, f));
