import { api, session } from '../services/api.js';
import { h, errorToast } from '../ui.js';
import { esc } from '../services/format.js';

export function renderLogin(root, { mode, onLogin }) {
  const cloud = mode === 'cloud';
  const el = h(`
    <div class="login">
      <div class="login-side">
        <div class="login-copy">
          <span class="login-eyebrow">Bulut + Lokal İstasyon Entegre</span>
          <h1>Dünyatek Salon Takip Yazılımı</h1>
          <p>Söz, nişan, düğün ve kına organizasyonlarınızı tek ekrandan planlayın ve takip edin. Rezervasyon takvimi, sözleşme, tahsilat ve ödeme planı, personel, gelir-gider ve barkodlu kantin satışı bir arada.</p>
          <ul>
            <li>İnternet kesilse de salon ağında çalışmaya devam eder</li>
            <li>Bulutla otomatik eşitlenir, her yerden erişim</li>
            <li>Barkod okuyucu ile tam uyumlu kantin kasası</li>
            <li>WhatsApp ile müşteri bilgilendirme</li>
          </ul>
          <div class="login-tags"><span>Salon Takip Yazılımı</span><span>Düğün Takip Sistemi</span><span>Her Yerden Erişim</span><span>Kolay Kullanım</span></div>
        </div>
      </div>
      <form class="card login-card">
        <div class="login-brand">
          <img src="/dunyatek-logo.png" alt="Dünyatek Bilişim" width="640" height="185" />
          <small>${cloud ? 'Bulut Yönetim Paneli' : 'Salon Takip Yazılımı'}</small>
        </div>
        ${
          cloud
            ? `<label>Yönetim anahtarı<input name="token" type="password" required autocomplete="current-password" /></label>`
            : `<label>Kullanıcı adı<input name="username" required autocomplete="username" autocapitalize="off" placeholder="ör. admin" /></label>
               <label>Şifre<input name="password" type="password" required autocomplete="current-password" /></label>
               <label>Kasa / terminal<input name="terminal" value="${esc(session.terminal)}" /></label>`
        }
        <button class="btn primary block" type="submit">Giriş yap</button>
        ${cloud ? '<p class="muted small">Salon işlemleri salondaki yerel sunucudan yapılır. Bu panel eşitlenen verileri gösterir.</p>' : ''}
        <p class="login-foot">© 2026 Dünyatek Bilişim. Tüm hakları saklıdır.</p>
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
