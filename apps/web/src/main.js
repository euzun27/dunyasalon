import './styles/main.css';
import { api, session } from './services/api.js';
import { esc } from './services/format.js';
import { h } from './ui.js';
import { renderLogin } from './pages/login.js';
import { renderPos } from './pages/pos.js';
import { renderInventory } from './pages/inventory.js';
import { renderReservations } from './pages/reservations.js';
import { renderAccounts } from './pages/accounts.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCloud } from './pages/cloud.js';

const app = document.getElementById('app');

const LOCAL_ROUTES = [
  { path: '/kasa', label: 'Kantin Kasa', icon: '🛒', render: renderPos, roles: ['kasiyer'] },
  { path: '/stok', label: 'Ürün & Stok', icon: '📦', render: renderInventory, roles: ['kasiyer', 'muhasebe'] },
  { path: '/rezervasyon', label: 'Rezervasyonlar', icon: '📅', render: renderReservations, roles: ['resepsiyon'] },
  { path: '/hesaplar', label: 'Düğün Hesapları', icon: '💍', render: renderAccounts, roles: ['resepsiyon', 'muhasebe', 'kasiyer'] },
  { path: '/ozet', label: 'Özet & Senkron', icon: '📊', render: renderDashboard, roles: ['muhasebe', 'kasiyer'] },
];

let mode = 'local';
let cleanup = null;

function allowed(route, user) {
  return user && (user.role === 'admin' || route.roles.includes(user.role));
}

function shell(routes, user, current) {
  return h(`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span>💍</span><div><strong>DUNYATEK</strong><small>${mode === 'cloud' ? 'Bulut Paneli' : 'Wedding ERP'}</small></div></div>
        <nav>
          ${routes
            .map((r) => `<a href="#${r.path}" class="${r.path === current ? 'active' : ''}"><span>${r.icon}</span>${esc(r.label)}</a>`)
            .join('')}
        </nav>
        <div class="sidebar-foot">
          <div class="net" id="net-status" title="Sunucu bağlantısı">●</div>
          <div class="who">${esc(user?.full_name ?? '')}<small>${esc(user?.role ?? '')}${mode === 'local' ? ' · ' + esc(session.terminal) : ''}</small></div>
          <button class="btn ghost small" id="logout">Çıkış</button>
        </div>
      </aside>
      <main id="page"></main>
    </div>`);
}

async function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const path = window.location.hash.replace(/^#/, '') || '/';
  const user = session.user;

  if (!session.token || path === '/giris') {
    app.replaceChildren();
    renderLogin(app, { mode, onLogin: () => (window.location.hash = '#/') });
    return;
  }

  const routes = mode === 'cloud'
    ? [{ path: '/bulut', label: 'Bulut Özeti', icon: '☁️', render: renderCloud, roles: [] }]
    : LOCAL_ROUTES.filter((r) => allowed(r, user));
  const target = routes.find((r) => r.path === path) ?? routes[0];
  if (!target) {
    app.replaceChildren(h('<div class="center-msg">Bu kullanıcı için tanımlı ekran yok.</div>'));
    return;
  }
  if (target.path !== path) {
    window.location.hash = `#${target.path}`;
    return;
  }
  const el = shell(routes, mode === 'cloud' ? { full_name: 'Uzaktan yönetim', role: 'admin' } : user, target.path);
  app.replaceChildren(el);
  el.querySelector('#logout').addEventListener('click', async () => {
    if (mode === 'local') await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.clear();
    window.location.hash = '#/giris';
  });
  cleanup = (await target.render(el.querySelector('#page'), { user, mode })) ?? null;
}

async function heartbeat() {
  const dot = document.getElementById('net-status');
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json();
    if (dot) {
      const pending = data.sync?.pending ?? 0;
      dot.className = `net ${data.sync?.enabled && !data.sync.online ? 'warn' : 'ok'}`;
      dot.title = data.sync?.enabled
        ? `Salon sunucusu çalışıyor · Bulut ${data.sync.online ? 'bağlı' : 'bağlantısı yok'} · Bekleyen ${pending} olay`
        : 'Sunucu çalışıyor';
    }
  } catch {
    if (dot) {
      dot.className = 'net down';
      dot.title = 'Sunucuya ulaşılamıyor';
    }
  }
}

async function start() {
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    mode = health.mode === 'cloud' ? 'cloud' : 'local';
  } catch {
    mode = 'local';
  }
  document.body.dataset.mode = mode;
  window.addEventListener('hashchange', route);
  await route();
  setInterval(heartbeat, 10_000);
  heartbeat();
}

start();
