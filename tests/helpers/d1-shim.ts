/**
 * Testler için Cloudflare D1 API'sinin node:sqlite üzerinde küçük bir taklidi.
 * Worker kodunun (apps/cloud-worker) gerçek D1 SQL'ini yerelde çalıştırmamızı sağlar.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Value = string | number | null;

class Stmt {
  params: Value[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...params: unknown[]) {
    const s = new Stmt(this.db, this.sql);
    s.params = params.map((p) => (p === undefined ? null : (p as Value)));
    return s;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
  exec() {
    const st = this.db.prepare(this.sql);
    return /^\s*(SELECT|WITH)/i.test(this.sql)
      ? { results: st.all(...this.params), success: true }
      : (st.run(...this.params), { results: [], success: true });
  }
}

export class D1Shim {
  readonly db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
    const dir = resolve(import.meta.dirname, '../../migrations/cloud');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.exec());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
