import { api, session } from '../services/api.js';
import { h, errorToast } from '../ui.js';
import { esc } from '../services/format.js';

export function renderLogin(root, { mode, onLogin }) {
  const cloud = mode === 'cloud';
  const el = h(`
    <div class="login">
      <form class="card login-card">
        <div class="brand big"><span>💍</span><div><strong>DUNYATEK</strong><small>${cloud ? 'Bulut Yönetim Paneli' : 'Wedding ERP · Salon'}</small></div></div>
        ${
          cloud
            ? `<label>Yönetim anahtarı<input name="token" type="password" required autocomplete="current-password" /></label>`
            : `<label>Kullanıcı adı<input name="username" required autocomplete="username" autocapitalize="off" /></label>
               <label>Şifre<input name="password" type="password" required autocomplete="current-password" /></label>
               <label>Kasa / terminal<input name="terminal" value="${esc(session.terminal)}" /></label>`
        }
        <button class="btn primary block" type="submit">Giriş yap</button>
        <p class="muted small">${cloud ? 'Salon işlemleri salondaki yerel sunucudan yapılır. Bu panel senkronize verileri gösterir.' : 'İnternet olmasa da salon ağı üzerinden çalışır.'}</p>
      </form>
    </div>`);
  root.append(el);
  el.querySelector('input').focus();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      if (cloud) {
        session.save(String(f.get('token')), { full_name: 'Uzaktan yönetim', role: 'admin' });
        await api('/cloud/summary');
      } else {
        session.terminal = String(f.get('terminal') || 'KASA-1').trim().toUpperCase();
        const res = await api('/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
        session.save(res.token, res.user);
      }
      onLogin();
    } catch (err) {
      if (cloud) session.clear();
      errorToast(err);
    }
  });
}
