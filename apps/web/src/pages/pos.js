import { api } from '../services/api.js';
import { esc, tl, qty, parseTL, METHOD_LABELS, QTY_SCALE } from '../services/format.js';
import { h, toast, errorToast, modal } from '../ui.js';

/**
 * Kantin kasası. Barkod okuyucular klavye gibi çalışır: rakamları yazar ve Enter gönderir.
 * Barkod alanı her zaman odakta tutulur.
 * Kısayollar: F2 nakit · F3 kart · F4 düğün hesabı · Esc sepeti temizle
 */
export async function renderPos(root) {
  const state = {
    saleId: crypto.randomUUID(),
    cart: [], // { product, qty }
    products: [],
    category: 'Tümü',
    busy: false,
  };

  root.append(
    h(`
    <div class="pos">
      <section class="pos-left">
        <div class="scan">
          <input id="barcode" class="scan-input" placeholder="Barkod okutun veya ürün adı yazın…" autocomplete="off" inputmode="search" />
          <div id="cash-session" class="cash-session"></div>
        </div>
        <div id="categories" class="chips"></div>
        <div id="grid" class="product-grid"></div>
      </section>
      <section class="pos-right card">
        <header class="cart-head"><h2>Sepet</h2><button class="btn ghost small" id="clear">Temizle (Esc)</button></header>
        <div id="cart" class="cart"></div>
        <div class="totals">
          <div><span>Ara toplam</span><strong id="subtotal">0,00 ₺</strong></div>
          <div class="grand"><span>TOPLAM</span><strong id="total">0,00 ₺</strong></div>
        </div>
        <div class="pay-buttons">
          <button class="btn pay cash" data-pay="nakit">💵 Nakit <kbd>F2</kbd></button>
          <button class="btn pay card" data-pay="kart">💳 Kart <kbd>F3</kbd></button>
          <button class="btn pay account" data-pay="dugun_hesabi">💍 Düğün hesabına yaz <kbd>F4</kbd></button>
        </div>
        <details class="last-sales"><summary>Son satışlar</summary><div id="last-sales"></div></details>
      </section>
    </div>`),
  );

  const $ = (s) => root.querySelector(s);
  const input = $('#barcode');

  const total = () => state.cart.reduce((s, l) => s + Math.round((l.product.price_kurus * l.qty) / QTY_SCALE), 0);

  function renderCart() {
    const cart = $('#cart');
    if (state.cart.length === 0) {
      cart.innerHTML = '<p class="empty">Sepet boş. Barkod okutarak başlayın.</p>';
    } else {
      cart.innerHTML = state.cart
        .map(
          (l, i) => `
        <div class="cart-line">
          <div class="cart-name">${esc(l.product.name)}<small>${tl(l.product.price_kurus)} · stok ${qty(l.product.stock_qty)}</small></div>
          <div class="qty-ctl">
            <button class="icon-btn" data-dec="${i}" aria-label="Azalt">−</button>
            <span>${qty(l.qty)}</span>
            <button class="icon-btn" data-inc="${i}" aria-label="Artır">+</button>
          </div>
          <strong>${tl(Math.round((l.product.price_kurus * l.qty) / QTY_SCALE))}</strong>
          <button class="icon-btn danger" data-del="${i}" aria-label="Sil">✕</button>
        </div>`,
        )
        .join('');
    }
    $('#subtotal').textContent = tl(total());
    $('#total').textContent = tl(total());
    root.querySelectorAll('[data-pay]').forEach((b) => (b.disabled = state.cart.length === 0));
  }

  function addToCart(product, units = 1) {
    const line = state.cart.find((l) => l.product.id === product.id);
    const next = (line?.qty ?? 0) + units * QTY_SCALE;
    if (product.track_stock && next > product.stock_qty) {
      toast(`Yetersiz stok: ${product.name} (mevcut ${qty(product.stock_qty)})`, 'error');
      beep(false);
      return;
    }
    if (line) line.qty = next;
    else state.cart.push({ product, qty: units * QTY_SCALE });
    beep(true);
    renderCart();
  }

  function renderGrid() {
    const cats = ['Tümü', ...new Set(state.products.map((p) => p.category || 'Diğer'))];
    $('#categories').innerHTML = cats
      .map((c) => `<button class="chip ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
    const list = state.products.filter((p) => state.category === 'Tümü' || (p.category || 'Diğer') === state.category);
    $('#grid').innerHTML = list
      .map(
        (p) => `
        <button class="product-tile ${p.track_stock && p.stock_qty <= 0 ? 'out' : ''}" data-pid="${p.id}">
          <span class="name">${esc(p.name)}</span>
          <span class="price">${tl(p.price_kurus)}</span>
          <span class="stock">${p.track_stock ? `Stok: ${qty(p.stock_qty)}` : ''}</span>
        </button>`,
      )
      .join('');
  }

  async function loadProducts() {
    state.products = await api('/products');
    renderGrid();
  }

  async function loadCashSession() {
    const s = await api('/pos/cash-session').catch(() => null);
    $('#cash-session').innerHTML = s
      ? `<span class="badge ok">Kasa açık</span> <small>Nakit ${tl(s.cash_kurus)} · Kart ${tl(s.card_kurus)} · Hesaba ${tl(s.on_account_kurus)}</small> <button class="btn ghost small" id="close-cash">Kasayı kapat</button>`
      : `<span class="badge warn">Kasa oturumu kapalı</span> <button class="btn ghost small" id="open-cash">Kasayı aç</button>`;
  }

  async function loadLastSales() {
    const sales = await api('/pos/sales', { query: { limit: 10 } }).catch(() => []);
    $('#last-sales').innerHTML = sales.length
      ? `<table class="table compact"><tbody>${sales
          .map(
            (s) =>
              `<tr class="${s.status === 'iade' ? 'muted' : ''}"><td>#${s.receipt_no}</td><td>${new Date(s.created_at).toLocaleTimeString('tr-TR', { timeStyle: 'short' })}</td><td>${tl(s.total_kurus)}</td><td>${s.status === 'iade' ? 'İade' : ''}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<p class="empty">Henüz satış yok.</p>';
  }

  async function onScan(code) {
    const text = code.trim();
    if (!text) return;
    // "3*barkod" → 3 adet
    const m = text.match(/^(\d+)\s*[*xX]\s*(.+)$/);
    const units = m ? Number(m[1]) : 1;
    const term = m ? m[2] : text;
    try {
      const product = await api(`/products/barcode/${encodeURIComponent(term)}`);
      addToCart(product, units);
    } catch (err) {
      if (err.status === 404) {
        const matches = state.products.filter((p) => p.name.toLocaleLowerCase('tr').includes(term.toLocaleLowerCase('tr')));
        if (matches.length === 1) return addToCart(matches[0], units);
        if (matches.length > 1) {
          state.category = 'Tümü';
          renderGrid();
          $('#grid').querySelectorAll('.product-tile').forEach((t) => {
            t.hidden = !matches.some((p) => p.id === t.dataset.pid);
          });
          return;
        }
      }
      beep(false);
      errorToast(err);
    }
  }

  async function checkout(method) {
    if (state.busy || state.cart.length === 0) return;
    const amount = total();
    let payments = [{ method, amount_kurus: amount }];
    let eventAccountId = null;

    if (method === 'nakit') {
      const ok = await new Promise((resolve) => {
        const m = modal({
          title: `Nakit tahsilat · ${tl(amount)}`,
          submitLabel: 'Satışı tamamla',
          body: `
            <label>Alınan tutar (₺)<input name="received" inputmode="decimal" placeholder="${(amount / 100).toFixed(2).replace('.', ',')}" /></label>
            <p class="change">Para üstü: <strong id="change">0,00 ₺</strong></p>`,
          onSubmit: (f) => {
            const received = f.get('received') ? parseTL(f.get('received')) : amount;
            if (received < amount) throw new Error('Alınan tutar toplamdan az');
            resolve(true);
          },
          onCancel: () => resolve(false),
        });
        m.form.received.addEventListener('input', (e) => {
          try {
            m.form.querySelector('#change').textContent = tl(Math.max(0, parseTL(e.target.value) - amount));
          } catch {
            /* yazım sürüyor */
          }
        });
      });
      if (!ok) return input.focus();
    }

    if (method === 'dugun_hesabi') {
      const accounts = await api('/event-accounts', { query: { status: 'acik' } });
      if (accounts.length === 0) return toast('Açık düğün hesabı yok. Önce rezervasyonu kesinleştirin.', 'error');
      eventAccountId = await new Promise((resolve) => {
        modal({
          title: `Düğün hesabına yaz · ${tl(amount)}`,
          submitLabel: 'Hesaba yaz',
          body: `<div class="account-pick">${accounts
            .map(
              (a, i) => `
              <label class="radio-card"><input type="radio" name="acc" value="${a.id}" ${i === 0 ? 'checked' : ''} />
                <span><strong>${esc(a.title)}</strong><small>Bakiye ${tl(a.balance_kurus)}${a.credit_limit_kurus != null ? ` · Limit ${tl(a.credit_limit_kurus)}` : ''}</small></span>
              </label>`,
            )
            .join('')}</div>`,
          onSubmit: (f) => resolve(String(f.get('acc'))),
          onCancel: () => resolve(null),
        });
      });
      if (!eventAccountId) return input.focus();
    }

    state.busy = true;
    try {
      const sale = await api('/pos/sales', {
        method: 'POST',
        body: {
          id: state.saleId,
          lines: state.cart.map((l) => ({ product_id: l.product.id, qty: l.qty })),
          payments,
          event_account_id: eventAccountId,
        },
      });
      toast(`Satış #${sale.receipt_no} tamamlandı · ${tl(sale.total_kurus)} · ${METHOD_LABELS[method]}`);
      state.cart = [];
      state.saleId = crypto.randomUUID();
      renderCart();
      await Promise.all([loadProducts(), loadCashSession(), loadLastSales()]);
    } catch (err) {
      // Bağlantı koptuysa aynı saleId ile tekrar denendiğinde çift satış oluşmaz.
      errorToast(err);
    } finally {
      state.busy = false;
      input.focus();
    }
  }

  // --- olaylar ---
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      onScan(v);
    }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pid) addToCart(state.products.find((p) => p.id === t.dataset.pid));
    else if (t.dataset.cat) {
      state.category = t.dataset.cat;
      renderGrid();
    } else if (t.dataset.inc !== undefined) {
      const l = state.cart[Number(t.dataset.inc)];
      addToCart(l.product, 1);
    } else if (t.dataset.dec !== undefined) {
      const i = Number(t.dataset.dec);
      state.cart[i].qty -= QTY_SCALE;
      if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
      renderCart();
    } else if (t.dataset.del !== undefined) {
      state.cart.splice(Number(t.dataset.del), 1);
      renderCart();
    } else if (t.dataset.pay) checkout(t.dataset.pay);
    else if (t.id === 'clear') {
      state.cart = [];
      renderCart();
    } else if (t.id === 'open-cash') {
      modal({
        title: 'Kasayı aç',
        body: '<label>Açılış nakdi (₺)<input name="cash" inputmode="decimal" value="0" /></label>',
        onSubmit: async (f) => {
          await api('/pos/cash-session/open', { method: 'POST', body: { opening_cash_kurus: parseTL(f.get('cash')) } });
          await loadCashSession();
        },
      });
    } else if (t.id === 'close-cash') {
      modal({
        title: 'Kasayı kapat',
        body: '<label>Sayılan nakit (₺)<input name="cash" inputmode="decimal" required /></label>',
        submitLabel: 'Kapat',
        onSubmit: async (f) => {
          const r = await api('/pos/cash-session/close', { method: 'POST', body: { counted_cash_kurus: parseTL(f.get('cash')) } });
          toast(`Kasa kapandı. Beklenen ${tl(r.expected_cash_kurus)}, fark ${tl(r.difference_kurus)}`, r.difference_kurus === 0 ? 'ok' : 'error');
          await loadCashSession();
        },
      });
    }
    if (!document.querySelector('.modal-backdrop')) input.focus();
  });

  const onKey = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.key === 'F2') (e.preventDefault(), checkout('nakit'));
    else if (e.key === 'F3') (e.preventDefault(), checkout('kart'));
    else if (e.key === 'F4') (e.preventDefault(), checkout('dugun_hesabi'));
    else if (e.key === 'Escape') {
      state.cart = [];
      renderCart();
    } else if (document.activeElement === document.body) input.focus();
  };
  window.addEventListener('keydown', onKey);

  renderCart();
  await Promise.all([loadProducts().catch(errorToast), loadCashSession(), loadLastSales()]);
  input.focus();
  return () => window.removeEventListener('keydown', onKey);
}

let audio;
function beep(ok) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.05;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.06 : 0.25));
  } catch {
    /* ses desteklenmiyor */
  }
}
