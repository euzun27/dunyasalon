import { api } from '../services/api.js';
import { esc, tl, qty, parseTL, QTY_SCALE } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow, beep } from '../ui.js';

/**
 * Barkodla hızlı sayım: raftaki ürünler tek tek okutulur, her okutma sayılan miktarı artırır.
 * Tanımsız barkod okutulunca ürün orada açılır. "Sayımı kaydet" ile sayılan ürünlerin stoğu
 * sayılan miktara eşitlenir; sayılmayan ürünlere dokunulmaz. Yarım kalan sayım bu tarayıcıda saklanır.
 */
const DRAFT_KEY = 'dunyatek.sayim.taslak';

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export async function renderStockCount(root, { user, setTitle }) {
  setTitle('Barkodla sayım');
  const canCreate = ['admin', 'muhasebe'].includes(user.role);
  root.append(
    h(`
    <div class="page count-page">
      <header class="page-head">
        <a class="btn ghost back" href="#/stok">← Ürün & Stok</a>
        <div class="actions">
          <button class="btn ghost" id="clear">Sayımı temizle</button>
          <button class="btn primary" id="save">Sayımı kaydet</button>
        </div>
      </header>
      <div class="card count-scan">
        <div class="scan">
          <div class="count-input">
            <input id="code" class="scan-input" placeholder="Barkod okutun veya ürün adı yazıp Enter'a basın…" autocomplete="off" inputmode="search" />
            <button type="button" class="btn ghost" id="kbd" hidden title="Ekran klavyesini aç/kapat">Klavye</button>
          </div>
          <div class="count-opts">
            <label>Her okutmada<input id="step" type="number" min="1" value="1" class="qty-input" /> adet ekle</label>
            <span class="muted small count-help">Koli okuturken adedi koli içi sayısına çevirin. Sayılan miktarı tablodan da düzeltebilirsiniz.</span>
          </div>
        </div>
        <div id="picker"></div>
        <div id="last" class="count-last muted">Okutulan ürün burada görünür.</div>
      </div>
      <div class="stats" id="stats"></div>
      <div class="card"><table class="table">
        <thead><tr><th>Ürün</th><th class="count-bc">Barkod</th><th class="num">Sistemdeki</th><th class="num">Sayılan</th><th class="num">Fark</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  const input = $('#code');

  let products = await api('/products', { query: { all: '1' } });
  let byId = new Map(products.map((p) => [p.id, p]));
  const byBarcode = () => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  let barcodes = byBarcode();

  // Sayım listesi: [{ id, qty }] en son okutulan en üstte; qty ölçekli (×1000)
  let lines = loadDraft().filter((l) => byId.has(l.id));
  const save = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(lines));
    } catch {
      /* depolama kapalıysa taslak saklanmaz */
    }
  };

  function render(flashId) {
    const changed = lines.filter((l) => l.qty !== byId.get(l.id).stock_qty).length;
    $('#stats').innerHTML = `
      <div class="stat card"><small>Sayılan ürün</small><strong>${lines.length}</strong></div>
      <div class="stat card"><small>Toplam adet</small><strong>${qty(lines.reduce((s, l) => s + l.qty, 0))}</strong></div>
      <div class="stat card"><small>Stoğu değişecek</small><strong>${changed}</strong></div>`;
    $('#save').textContent = lines.length ? `Sayımı kaydet (${lines.length} ürün)` : 'Sayımı kaydet';
    $('#rows').innerHTML = lines.length
      ? lines
          .map((l) => {
            const p = byId.get(l.id);
            const diff = l.qty - p.stock_qty;
            return `<tr class="${l.id === flashId ? 'flash' : ''}">
              <td>${esc(p.name)}${p.track_stock ? '' : ' <span class="badge">stok takibi kapalı</span>'}</td>
              <td class="mono count-bc">${esc(p.barcode ?? '—')}</td>
              <td class="num">${qty(p.stock_qty)}</td>
              <td class="num"><input class="qty-input" data-qty="${l.id}" inputmode="decimal" value="${qty(l.qty)}" /></td>
              <td class="num ${diff < 0 ? 'neg' : diff > 0 ? 'qty-in' : 'muted'}">${diff > 0 ? '+' : ''}${qty(diff)}</td>
              <td class="row-actions"><button class="btn ghost small" data-remove="${l.id}" title="Çıkar"><span class="count-rm-txt">Çıkar</span><span class="count-rm-x">✕</span></button></td>
            </tr>`;
          })
          .join('')
      : emptyRow(6, 'Henüz ürün okutulmadı');
  }

  function add(p) {
    const step = Math.max(1, Number($('#step').value) || 1) * QTY_SCALE;
    const i = lines.findIndex((l) => l.id === p.id);
    const line = i >= 0 ? lines.splice(i, 1)[0] : { id: p.id, qty: 0 };
    line.qty += step;
    lines.unshift(line);
    save();
    beep(true);
    $('#picker').innerHTML = '';
    $('#last').className = 'count-last ok';
    $('#last').innerHTML = `<strong>${esc(p.name)}</strong> · sayılan <strong>${qty(line.qty)}</strong> ${esc(p.unit)} · sistemde ${qty(p.stock_qty)} · ${tl(p.price_kurus)}`;
    render(p.id);
    if (!document.querySelector('.modal-backdrop')) input.focus();
  }

  function unknown(code) {
    beep(false);
    $('#last').className = 'count-last warn';
    if (!canCreate) {
      $('#last').innerHTML = `<strong>${esc(code)}</strong> barkodlu ürün tanımlı değil. Yönetici ya da muhasebe kullanıcısı ürünü eklemeli; bu ürünü bir kenara ayırın.`;
      return;
    }
    $('#last').innerHTML = `<strong>${esc(code)}</strong> barkodlu ürün tanımlı değil, şimdi ekleyin.`;
    const cats = [...new Set(products.map((x) => x.category).filter(Boolean))];
    modal({
      title: 'Yeni ürün · okutulan barkod',
      submitLabel: 'Ekle ve say',
      body: `
        <label>Barkod<input name="barcode" value="${esc(code)}" /></label>
        <label>Ürün adı<input name="name" required /></label>
        <div class="grid-2">
          <label>Kategori<input name="category" list="count-cats" /></label>
          <label>Satış fiyatı (₺, KDV dahil)<input name="price" required inputmode="decimal" /></label>
          <label>KDV %<input name="vat" type="number" min="0" max="100" value="10" /></label>
          <label>Birim<input name="unit" value="adet" /></label>
        </div>
        <datalist id="count-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`,
      onSubmit: async (f) => {
        if (!String(f.get('name')).trim()) throw new Error('Ürün adı boş');
        if (!String(f.get('price')).trim()) throw new Error('Satış fiyatı boş');
        const p = await api('/products', {
          method: 'POST',
          body: {
            barcode: f.get('barcode') || null,
            name: f.get('name'),
            category: f.get('category') || null,
            unit: f.get('unit') || 'adet',
            price_kurus: parseTL(f.get('price')),
            vat_rate: Number(f.get('vat')),
            track_stock: true,
            active: true,
          },
        });
        const full = { ...p, stock_qty: 0 };
        products.push(full);
        byId.set(full.id, full);
        barcodes = byBarcode();
        add(full);
        setTimeout(() => input.focus(), 0); // pencere kapandıktan sonra okutmaya dön
      },
      onCancel: () => input.focus(),
    }).form.querySelector('[name=name]').focus();
  }

  function lookup(term) {
    const code = term.replace(/\s/g, '');
    const hit = barcodes.get(code);
    if (hit) return add(hit);
    if (/^\d{6,}$/.test(code)) return unknown(code);
    const q = term.toLocaleLowerCase('tr');
    const found = products.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)).slice(0, 12);
    if (found.length === 1) return add(found[0]);
    if (!found.length) {
      beep(false);
      $('#picker').innerHTML = '';
      $('#last').className = 'count-last warn';
      $('#last').textContent = `"${term}" ile eşleşen ürün yok.`;
      return;
    }
    $('#picker').innerHTML = `<div class="chips">${found.map((p) => `<button class="chip" data-pick="${p.id}">${esc(p.name)}</button>`).join('')}</div>`;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = input.value.trim();
    input.value = '';
    if (term) lookup(term);
  });

  root.addEventListener('change', (e) => {
    const id = e.target.dataset?.qty;
    if (!id) return;
    const n = Number(String(e.target.value).replace(',', '.'));
    const line = lines.find((l) => l.id === id);
    if (!Number.isFinite(n) || n < 0) {
      errorToast(new Error('Sayılan miktar geçersiz'));
      e.target.value = qty(line.qty);
      return;
    }
    line.qty = Math.round(n * QTY_SCALE);
    save();
    render();
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pick) add(byId.get(b.dataset.pick));
    if (b.dataset.remove) {
      lines = lines.filter((l) => l.id !== b.dataset.remove);
      save();
      render();
    }
    if (b.id === 'clear' && lines.length) {
      modal({
        title: 'Sayımı temizle',
        submitLabel: 'Temizle',
        body: `<p>Okutulan ${lines.length} ürün listeden silinecek. Stoklara dokunulmaz.</p>`,
        onSubmit: () => {
          lines = [];
          save();
          render();
        },
      });
    }
    if (b.id === 'save') {
      if (!lines.length) return toast('Önce ürün okutun', 'error');
      const changed = lines.filter((l) => l.qty !== byId.get(l.id).stock_qty).length;
      modal({
        title: 'Sayımı kaydet',
        submitLabel: 'Stokları güncelle',
        body: `<p>Sayılan <strong>${lines.length}</strong> ürünün stoğu sayılan miktara eşitlenecek; <strong>${changed}</strong> üründe stok değişecek.</p>
          <p class="muted small">Listede olmayan ürünlerin stoğuna dokunulmaz. Kayıttan sonra stok hareketlerinde "Sayım" olarak görünür.</p>`,
        onSubmit: async () => {
          const r = await api('/stock/count', { method: 'POST', body: { items: lines.map((l) => ({ product_id: l.id, qty: l.qty })) } });
          lines = [];
          save();
          products = await api('/products', { query: { all: '1' } });
          byId = new Map(products.map((p) => [p.id, p]));
          barcodes = byBarcode();
          $('#last').className = 'count-last ok';
          $('#last').textContent = `Sayım kaydedildi: ${r.counted} ürün sayıldı, ${r.changed} ürünün stoğu güncellendi.`;
          toast('Sayım kaydedildi');
          render();
        },
      });
    }
  });

  // El terminali (dokunmatik): okuyucu klavye gibi yazar, ekran klavyesi ekranı kapatmasın.
  // Ürün adı yazmak gerektiğinde "Klavye" düğmesi ekran klavyesini açar.
  if (matchMedia('(pointer: coarse)').matches) {
    input.inputMode = 'none';
    $('#kbd').hidden = false;
    $('#kbd').addEventListener('click', () => {
      input.inputMode = input.inputMode === 'none' ? 'search' : 'none';
      $('#kbd').classList.toggle('active', input.inputMode !== 'none');
      input.blur();
      input.focus();
    });
  }

  // Okuyucu her zaman okutma kutusuna yazsın: ekrana tıklanınca ya da odak boştayken tuşa basılınca kutuya dön
  root.addEventListener('click', (e) => {
    if (document.querySelector('.modal-backdrop') || e.target.closest('input, select, textarea')) return;
    input.focus();
  });
  const onKey = () => {
    if (!document.querySelector('.modal-backdrop') && document.activeElement === document.body) input.focus();
  };
  window.addEventListener('keydown', onKey);
  render();
  if (lines.length) {
    $('#last').textContent = `Yarım kalan sayım açıldı: ${lines.length} ürün. Kaldığınız yerden okutmaya devam edebilirsiniz.`;
  }
  input.focus();
  return () => window.removeEventListener('keydown', onKey);
}
