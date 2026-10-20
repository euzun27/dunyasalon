import './styles/main.css';
import { api, session } from './services/api.js';
import { esc } from './services/format.js';
import { h } from './ui.js';
import { icon } from './icons.js';
import { renderLogin } from './pages/login.js';
import { renderHome } from './pages/home.js';
import { renderPos } from './pages/pos.js';
import { renderInventory } from './pages/inventory.js';
import { renderStockCount } from './pages/stock-count.js';
import { renderReservations } from './pages/reservations.js';
import { renderReservationDetail } from './pages/reservation-detail.js';
import { renderCustomers, renderCustomerDetail } from './pages/customers.js';
import { renderAccounts } from './pages/accounts.js';
import { renderFinance } from './pages/finance.js';
import { renderReports } from './pages/reports.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderServices } from './pages/services.js';
import { renderStaff } from './pages/staff.js';
import { renderSettings } from './pages/settings.js';
import { renderCloud } from './pages/cloud.js';

const app = document.getElementById('app');

const ALL = ['kasiyer', 'resepsiyon', 'muhasebe'];
const NAV = [
  { group: null, items: [{ path: '/ana-sayfa', label: 'Ana Sayfa', icon: 'home', render: renderHome, roles: ALL }] },
  {
    group: 'Organizasyon',
    items: [
      { path: '/rezervasyon', label: 'Rezervasyonlar', icon: 'calendar', render: renderReservations, roles: ['resepsiyon', 'muhasebe'] },
      { path: '/musteriler', label: 'Müşteriler', icon: 'users', render: renderCustomers, roles: ['resepsiyon', 'muhasebe'] },
      { path: '/hizmetler', label: 'Menü & Hizmetler', icon: 'menu', render: renderServices, roles: ['resepsiyon', 'muhasebe'] },
      { path: '/personel', label: 'Personel', icon: 'staff', render: renderStaff, roles: ['resepsiyon', 'muhasebe'] },
    ],
  },
  {
    group: 'Kantin',
    items: [
      { path: '/kasa', label: 'Kantin Kasa', icon: 'cart', render: renderPos, roles: ['kasiyer'] },
      { path: '/stok', label: 'Ürün & Stok', icon: 'box', render: renderInventory, roles: ['kasiyer', 'muhasebe'] },
      { path: '/hesaplar', label: 'Kantin Hesapları', icon: 'ring', render: renderAccounts, roles: ALL },
      { path: '/kantin-raporu', label: 'Kantin Raporu', icon: 'receipt', render: renderDashboard, roles: ['kasiyer', 'muhasebe'] },
    ],
  },
  {
    group: 'Finans',
    items: [
      { path: '/finans', label: 'Gelir & Gider', icon: 'wallet', render: renderFinance, roles: ['muhasebe'] },
      { path: '/raporlar', label: 'Raporlar', icon: 'chart', render: renderReports, roles: ['muhasebe'] },
    ],
  },
  { group: 'Yönetim', items: [{ path: '/ayarlar', label: 'Ayarlar', icon: 'settings', render: renderSettings, roles: [] }] },
];

// Menüde görünmeyen ayrıntı sayfaları: #/rezervasyon/:id, #/musteri/:id, #/stok/sayim
const DETAIL_ROUTES = [
  { pattern: /^\/rezervasyon\/([\w-]+)$/, parent: '/rezervasyon', render: renderReservationDetail, roles: ['resepsiyon', 'muhasebe'] },
  { pattern: /^\/musteri\/([\w-]+)$/, parent: '/musteriler', render: renderCustomerDetail, roles: ['resepsiyon', 'muhasebe'] },
  { pattern: /^\/stok\/sayim$/, parent: '/stok', render: renderStockCount, roles: ['kasiyer', 'muhasebe'] },
];

let mode = 'local';
let cleanup = null;

const allowed = (route, user) => user && (user.role === 'admin' || route.roles.includes(user.role));
const ROLE_LABELS = { admin: 'Yönetici', kasiyer: 'Kasiyer', resepsiyon: 'Resepsiyon', muhasebe: 'Muhasebe' };

function shell(groups, user, activePath, title) {
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return h(`
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/">
          <span class="brand-mark">${icon('ring', 22)}</span>
          <div><strong>DUNYATEK</strong><small>${mode === 'cloud' ? 'Bulut Paneli' : 'Salon Yönetimi'}</small></div>
        </a>
        <nav>
          ${groups
            .map(
              (g) => `
            ${g.group ? `<div class="nav-group">${esc(g.group)}</div>` : ''}
            ${g.items
              .map((r) => `<a href="#${r.path}" class="${r.path === activePath ? 'active' : ''}">${icon(r.icon)}<span>${esc(r.label)}</span></a>`)
              .join('')}`,
            )
            .join('')}
        </nav>
        <div class="sidebar-foot">
          <div class="avatar">${esc((user?.full_name ?? '?').slice(0, 1).toLocaleUpperCase('tr'))}</div>
          <div class="who">${esc(user?.full_name ?? '')}<small>${esc(ROLE_LABELS[user?.role] ?? '')}${mode === 'local' ? ' · ' + esc(session.terminal) : ''}</small></div>
          <button class="icon-btn ghost" id="logout" title="Çıkış">${icon('logout')}</button>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <div class="topbar-title"><h1 id="page-title">${esc(title)}</h1><small>${esc(today)}</small></div>
          <div class="topbar-actions">
            <span class="net" id="net-status" title="Sunucu bağlantısı"><i></i><span>Bağlanıyor…</span></span>
          </div>
        </header>
        <main id="page"></main>
      </div>
    </div>`);
}

async function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const [rawPath, query = ''] = window.location.hash.replace(/^#/, '').split('?');
  const path = rawPath || '/';
  const user = session.user;

  if (!session.token || path === '/giris') {
    app.replaceChildren();
    renderLogin(app, { mode, onLogin: () => (window.location.hash = '#/') });
    return;
  }

  const groups =
    mode === 'cloud'
      ? [
          {
            group: null,
            items: [
              { path: '/bulut', label: 'Bulut Özeti', icon: 'cloud', render: renderCloud, roles: [] },
              { path: '/bulut-raporlar', label: 'Raporlar', icon: 'chart', render: (root, ctx) => renderReports(root, ctx, { cloud: true }), roles: [] },
            ],
          },
        ]
      : NAV.map((g) => ({ ...g, items: g.items.filter((r) => allowed(r, user)) })).filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);

  let target = flat.find((r) => r.path === path);
  let params = [];
  if (!target && mode === 'local') {
    for (const d of DETAIL_ROUTES) {
      const m = path.match(d.pattern);
      if (m && allowed(d, user)) {
        const parent = flat.find((r) => r.path === d.parent);
        target = { ...d, path: d.parent, label: parent?.label ?? '' };
        params = m.slice(1);
      }
    }
  }
  if (!target) {
    const first = flat[0];
    if (!first) {
      app.replaceChildren(h('<div class="center-msg">Bu kullanıcı için tanımlı ekran yok.</div>'));
      return;
    }
    window.location.hash = `#${first.path}`;
    return;
  }
  const shownUser = mode === 'cloud' ? { full_name: 'Uzaktan yönetim', role: 'admin' } : user;
  const el = shell(groups, shownUser, target.path, target.label);
  app.replaceChildren(el);
  el.querySelector('#logout').addEventListener('click', async () => {
    if (mode === 'local') await api('/auth/logout', { method: 'POST' }).catch(() => {});
    session.clear();
    window.location.hash = '#/giris';
  });
  const page = el.querySelector('#page');
  const setTitle = (t) => (el.querySelector('#page-title').textContent = t);
  cleanup = (await target.render(page, { user, mode, params, setTitle, query: new URLSearchParams(query) })) ?? null;
  heartbeat();
}

async function heartbeat() {
  const el = document.getElementById('net-status');
  if (!el) return;
  const label = el.querySelector('span');
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json();
    const s = data.sync;
    if (mode === 'cloud') {
      el.className = 'net ok';
      label.textContent = 'Bulut';
    } else if (s?.enabled && !s.online) {
      el.className = 'net warn';
      label.textContent = `Çevrimdışı · ${s.pending} bekleyen`;
    } else {
      el.className = 'net ok';
      label.textContent = s?.enabled ? 'Çevrimiçi · eşitlendi' : 'Salon sunucusu';
    }
    el.title = s?.enabled ? `Bulut ${s.online ? 'bağlı' : 'bağlantısı yok'} · bekleyen ${s.pending} olay` : 'Salon sunucusu çalışıyor';
  } catch {
    el.className = 'net down';
    label.textContent = 'Sunucuya ulaşılamıyor';
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
}

start();
