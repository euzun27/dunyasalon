import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { newId, nowIso, requireString, ValidationError, type Role } from '@dunyatek/shared';
import { one, run, type DB } from '../database/db.ts';
import { audit } from '../database/outbox.ts';

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

const ROLES: Role[] = ['admin', 'kasiyer', 'resepsiyon', 'muhasebe'];

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createUser(
  db: DB,
  input: { username: string; full_name: string; role: Role; password: string },
): SessionUser {
  const username = requireString(input.username, 'Kullanıcı adı', 50).toLowerCase();
  const fullName = requireString(input.full_name, 'Ad soyad', 100);
  if (!ROLES.includes(input.role)) throw new ValidationError('Geçersiz rol');
  if (typeof input.password !== 'string' || input.password.length < 6) {
    throw new ValidationError('Şifre en az 6 karakter olmalıdır');
  }
  const id = newId();
  const now = nowIso();
  run(
    db,
    'INSERT INTO users (id, username, full_name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    username,
    fullName,
    input.role,
    hashPassword(input.password),
    now,
    now,
  );
  return { id, username, full_name: fullName, role: input.role };
}

export function login(db: DB, username: string, password: string, sessionHours: number) {
  const user = one<SessionUser & { password_hash: string; active: number }>(
    db,
    'SELECT id, username, full_name, role, password_hash, active FROM users WHERE username = ?',
    String(username ?? '').trim().toLowerCase(),
  );
  if (!user || !user.active || !verifyPassword(String(password ?? ''), user.password_hash)) {
    throw new AuthError('Kullanıcı adı veya şifre hatalı');
  }
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + sessionHours * 3600_000);
  run(
    db,
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    tokenHash(token),
    user.id,
    now.toISOString(),
    expires.toISOString(),
  );
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  audit(db, user.id, 'auth.login', 'user', user.id);
  const { password_hash: _ph, active: _a, ...publicUser } = user;
  return { token, expires_at: expires.toISOString(), user: publicUser as SessionUser };
}

export function logout(db: DB, token: string): void {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash(token));
}

export function userFromToken(db: DB, token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const row = one<SessionUser>(
    db,
    `SELECT u.id, u.username, u.full_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    tokenHash(token),
    nowIso(),
  );
  return row ?? null;
}

export function assertRole(user: SessionUser, roles: Role[]): void {
  if (user.role !== 'admin' && !roles.includes(user.role)) {
    throw new AuthError('Bu işlem için yetkiniz yok', 403);
  }
}
