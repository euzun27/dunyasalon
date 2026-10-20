import { api } from '../services/api.js';
import { esc, tl, qty, today, dateTimeTR, METHOD_LABELS } from '../services/format.js';
import { h, toast, errorToast, emptyRow } from '../ui.js';

export async function renderDashboard(root, { user }) {
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        
        <div class="actions"><input type="date" id="date" value="${today()}" /></div>
      </header>
      <div class="stats" id="stats"></div>
      <div class="split">
        <div class="card"><h2>En çok satanlar</h2><table class="table compact"><tbody id="top"></tbody></table></div>
        <div class="card"><h2>Azalan stok</h2><table class="table compact"><tbody id="low"></tbody></table></div>
      </div>
      <div class="card" id="sync"></div>
      <div class="card"><h2>Satışlar</h2><table class="table compact">
        <thead><tr><th>Fiş</th><th>Saat</th><th>Kasa</th><th class="num">Tutar</th><th>Durum</th><th></th></tr></thead>
        <tbody id="sales"></tbody></table></div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  const canRefund = ['admin', 'muhasebe'].includes(user.role);

  async function load() {
    const date = $('#date').value;
    const [r, sales, sync] = await Promise.all([
      api('/reports/daily', { query: { date } }),
      api('/pos/sales', { query: { date, limit: 500 } }),
      api('/sync/status'),
    ]);
    $('#stats').innerHTML = [
      ['Satış adedi', r.sale_count],
      ['Ciro', tl(r.total_kurus)],
      ...Object.entries(METHOD_LABELS).map(([k, v]) => [v, tl(r.by_method[k] ?? 0)]),
      ['İade', `${r.refunds.count} · ${tl(r.refunds.total_kurus)}`],
    ]
      .map(([k, v]) => `<div class="stat card"><small>${k}</small><strong>${v}</strong></div>`)
      .join('');
    $('#top').innerHTML = r.top_products.length
      ? r.top_products.map((p) => `<tr><td>${esc(p.product_name)}</td><td class="num">${qty(p.qty)}</td><td class="num">${tl(p.total)}</td></tr>`).join('')
      : emptyRow(3, 'Satış yok');
    $('#low').innerHTML = r.low_stock.length
      ? r.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="num warn-text">${qty(p.qty)}</td></tr>`).join('')
      : emptyRow(2, 'Stoklar yeterli');
    $('#sales').innerHTML = sales.length
      ? sales
          .map(
            (s) => `<tr class="${s.status === 'iade' ? 'muted' : ''}"><td>#${s.receipt_no}</td><td>${dateTimeTR(s.created_at)}</td><td>${esc(s.terminal)}</td>
              <td class="num">${tl(s.total_kurus)}</td><td>${s.status === 'iade' ? 'İade' : 'Tamamlandı'}</td>
              <td class="row-actions">${canRefund && s.status !== 'iade' ? `<button class="btn ghost small" data-refund="${s.id}" data-no="${s.receipt_no}">İade</button>` : ''}</td></tr>`,
          )
          .join('')
      : emptyRow(6, 'Satış yok');
    $('#sync').innerHTML = `
      <h2>Bulut senkronizasyonu</h2>
      ${
        sync.enabled
          ? `<p><span class="badge ${sync.online ? 'ok' : 'warn'}">${sync.online ? 'Bağlı' : 'Bağlantı yok'}</span>
              Bekleyen olay: <strong>${sync.pending}</strong> · Gönderilen: ${sync.sent}${sync.failed ? ` · Hatalı: <strong class="warn-text">${sync.failed}</strong>` : ''}</p>
             <p class="muted small">Son gönderim: ${dateTimeTR(sync.last_push_at) || '—'} · Son alım: ${dateTimeTR(sync.last_pull_at) || '—'}${sync.last_error ? ` · Son hata: ${esc(sync.last_error)}` : ''}</p>
             ${user.role === 'admin' ? '<button class="btn ghost small" id="sync-now">Şimdi eşitle</button>' : ''}`
          : `<p class="muted">Bulut bağlantısı yapılandırılmamış (CLOUD_URL / CLOUD_TOKEN). Tüm işlemler yerelde kaydedilir; bekleyen olay: <strong>${sync.pending}</strong>.</p>`
      }`;
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.refund) {
      if (!window.confirm(`#${b.dataset.no} numaralı satış iade edilsin mi? Stok geri alınır.`)) return;
      try {
        await api(`/pos/sales/${b.dataset.refund}/refund`, { method: 'POST', body: {} });
        toast('Satış iade edildi');
        await load();
      } catch (err) {
        errorToast(err);
      }
    }
    if (b.id === 'sync-now') {
      const r = await api('/sync/run', { method: 'POST' }).catch(errorToast);
      if (r) toast(`Gönderilen ${r.pushed}, alınan ${r.pulled}`);
      await load();
    }
  });
  $('#date').addEventListener('change', () => load().catch(errorToast));
  await load().catch(errorToast);
}
