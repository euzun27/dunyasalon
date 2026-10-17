import { api } from '../services/api.js';
import { esc, tl, qty, parseTL, dateTimeTR, QTY_SCALE } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';

const MOVE_LABELS = { giris: 'Giriş', satis: 'Satış', iade: 'İade', sayim: 'Sayım', fire: 'Fire' };

export async function renderInventory(root, { user }) {
  const canEdit = ['admin', 'muhasebe'].includes(user.role);
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        
        <div class="actions">
          <input id="q" class="search" placeholder="Ad veya barkod ara…" />
          ${canEdit ? '<button class="btn primary" id="new">+ Yeni ürün</button>' : ''}
        </div>
      </header>
      <div class="card"><table class="table">
        <thead><tr><th>Barkod</th><th>Ürün</th><th>Kategori</th><th class="num">Fiyat</th><th class="num">Stok</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
      <h2 class="section-title">Son stok hareketleri</h2>
      <div class="card"><table class="table compact">
        <thead><tr><th>Tarih</th><th>Ürün</th><th>Tür</th><th class="num">Miktar</th><th>Not</th></tr></thead>
        <tbody id="moves"></tbody>
      </table></div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  let products = [];

  async function load() {
    products = await api('/products', { query: { q: $('#q').value.trim(), all: '1' } });
    $('#rows').innerHTML = products.length
      ? products
          .map(
            (p) => `
        <tr class="${p.active ? '' : 'muted'}">
          <td class="mono">${esc(p.barcode ?? '—')}</td>
          <td>${esc(p.name)}${p.active ? '' : ' <span class="badge">pasif</span>'}</td>
          <td>${esc(p.category ?? '')}</td>
          <td class="num">${tl(p.price_kurus)}</td>
          <td class="num ${p.track_stock && p.stock_qty <= 5 * QTY_SCALE ? 'warn-text' : ''}">${p.track_stock ? qty(p.stock_qty) + ' ' + esc(p.unit) : '—'}</td>
          <td class="row-actions">
            <button class="btn ghost small" data-move="${p.id}">Stok</button>
            ${canEdit ? `<button class="btn ghost small" data-edit="${p.id}">Düzenle</button>` : ''}
          </td>
        </tr>`,
          )
          .join('')
      : emptyRow(6, 'Ürün bulunamadı');
    const moves = await api('/stock/movements', { query: { limit: 50 } });
    $('#moves').innerHTML = moves.length
      ? moves
          .map(
            (m) => `<tr><td>${dateTimeTR(m.created_at)}</td><td>${esc(m.product_name)}</td><td>${MOVE_LABELS[m.type] ?? m.type}</td>
              <td class="num ${m.qty_delta < 0 ? 'neg' : 'qty-in'}">${m.qty_delta > 0 ? '+' : ''}${qty(m.qty_delta)}</td><td>${esc(m.note ?? (m.ref_type === 'pos_sale' ? 'Kantin satışı' : ''))}</td></tr>`,
          )
          .join('')
      : emptyRow(5, 'Hareket yok');
  }

  function productForm(p = {}) {
    modal({
      title: p.id ? 'Ürünü düzenle' : 'Yeni ürün',
      body: `
        <label>Barkod<input name="barcode" value="${esc(p.barcode ?? '')}" placeholder="Okutun veya yazın" /></label>
        <label>Ürün adı<input name="name" required value="${esc(p.name ?? '')}" /></label>
        <div class="grid-2">
          <label>Kategori<input name="category" value="${esc(p.category ?? '')}" list="cats" /></label>
          <label>Birim<input name="unit" value="${esc(p.unit ?? 'adet')}" /></label>
          <label>Satış fiyatı (₺, KDV dahil)<input name="price" required inputmode="decimal" value="${p.price_kurus != null ? (p.price_kurus / 100).toFixed(2).replace('.', ',') : ''}" /></label>
          <label>KDV %<input name="vat" type="number" min="0" max="100" value="${p.vat_rate ?? 10}" /></label>
        </div>
        <label class="check"><input type="checkbox" name="track" ${p.track_stock === 0 ? '' : 'checked'} /> Stok takibi yap</label>
        ${p.id ? `<label class="check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'} /> Satışta</label>` : ''}
        <datalist id="cats">${[...new Set(products.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`,
      onSubmit: async (f) => {
        const body = {
          barcode: f.get('barcode') || null,
          name: f.get('name'),
          category: f.get('category') || null,
          unit: f.get('unit') || 'adet',
          price_kurus: parseTL(f.get('price')),
          vat_rate: Number(f.get('vat')),
          track_stock: f.get('track') === 'on',
          active: p.id ? f.get('active') === 'on' : true,
        };
        if (p.id) await api(`/products/${p.id}`, { method: 'PUT', body });
        else await api('/products', { method: 'POST', body });
        toast('Ürün kaydedildi');
        await load();
      },
    });
  }

  function moveForm(p) {
    modal({
      title: `Stok hareketi · ${p.name}`,
      body: `
        <p class="muted">Mevcut stok: <strong>${qty(p.stock_qty)} ${esc(p.unit)}</strong></p>
        <label>Hareket türü<select name="type">
          <option value="giris">Giriş (alım)</option>
          <option value="sayim">Sayım (yeni miktar)</option>
          <option value="fire">Fire / zayi</option>
        </select></label>
        <label>Miktar<input name="qty" required inputmode="decimal" /></label>
        <label>Birim maliyet (₺, isteğe bağlı)<input name="cost" inputmode="decimal" /></label>
        <label>Not<input name="note" /></label>`,
      onSubmit: async (f) => {
        const units = Number(String(f.get('qty')).replace(',', '.'));
        if (!Number.isFinite(units) || units < 0) throw new Error('Miktar geçersiz');
        await api('/stock/movements', {
          method: 'POST',
          body: {
            product_id: p.id,
            type: f.get('type'),
            qty: Math.round(units * QTY_SCALE),
            unit_cost_kurus: f.get('cost') ? parseTL(f.get('cost')) : null,
            note: f.get('note') || null,
          },
        });
        toast('Stok güncellendi');
        await load();
      },
    });
  }

  let t;
  $('#q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => load().catch(errorToast), 250);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'new') productForm();
    if (b.dataset.edit) productForm(products.find((p) => p.id === b.dataset.edit));
    if (b.dataset.move) moveForm(products.find((p) => p.id === b.dataset.move));
  });
  await load().catch(errorToast);
}
