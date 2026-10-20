import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));

export function defaultMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // Kaynak koddan (src/database) ve paketlenmiş dosyadan (dist) çalışırken
  const candidates = [resolve(here, '../../../../migrations/local'), resolve(here, '../../../migrations/local')];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

export function openDatabase(path: string, migrationsDir = defaultMigrationsDir()): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db, migrationsDir);
  return db;
}

export function migrate(db: DB, dir: string): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
    ran.push(file);
  }
  return ran;
}

const depth = new WeakMap<DB, number>();

/**
 * BEGIN IMMEDIATE: yazma kilidini en baştan alır. Böylece stok/rezervasyon
 * kontrolü ile yazma arasında başka bir yazıcı araya giremez.
 * İç içe çağrılarda SAVEPOINT kullanılır; iç hata yalnızca kendi kısmını geri alır.
 */
export function tx<T>(db: DB, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const sp = `sp_${level}`;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}

type Param = string | number | bigint | null | Uint8Array;

export function one<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: DB, sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

export function getSetting(db: DB, key: string): string | null {
  return one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
