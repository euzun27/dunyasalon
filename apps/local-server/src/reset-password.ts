/**
 * Unutulan şifreyi sıfırlar ve kullanıcıları listeler (sunucu kapalıyken de çalışır).
 * Kullanım: npm run sifre -- <kullanıcı adı> "<yeni şifre>"
 *           npm run sifre            (yalnızca kullanıcıları listeler)
 */
import { nowIso } from '@dunyatek/shared';
import { loadConfig } from './config.ts';
import { all, one, openDatabase, run } from './database/db.ts';
import { hashPassword } from './modules/auth.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const [username, password] = process.argv.slice(2);

const users = all<{ username: string; full_name: string; role: string; active: number }>(
  db, 'SELECT username, full_name, role, active FROM users ORDER BY username');
console.log('Kullanıcılar (girişte "kullanıcı adı" yazılır):');
for (const u of users) console.log(`  ${u.username.padEnd(16)} ${u.full_name} · ${u.role}${u.active ? '' : ' (pasif)'}`);

if (username) {
  const key = username.trim().toLowerCase();
  const user = one<{ id: string }>(db, 'SELECT id FROM users WHERE username = ?', key);
  if (!user) {
    console.error(`"${key}" adlı kullanıcı yok.`);
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error('Yeni şifre en az 6 karakter olmalıdır.');
    process.exit(1);
  }
  run(db, 'UPDATE users SET password_hash = ?, active = 1, updated_at = ? WHERE id = ?', hashPassword(password), nowIso(), user.id);
  run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
  console.log(`"${key}" kullanıcısının şifresi değiştirildi.`);
}
