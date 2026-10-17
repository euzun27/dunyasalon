import { api } from '../services/api.js';
import { esc, tl, qty, today, dateTR, dateTimeTR, STATUS_LABELS, METHOD_LABELS } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';

/** panel.truvapark.com.tr uzaktan yönetim paneli: senkronize verileri gösterir, yalnızca rezervasyon TALEBİ alır. */
export async function renderCloud(root) {
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        
        <div class="actions"><input type="date" id="date" value="${today()}" /><button class="btn primary" id="request">+ Rezervasyon talebi</button></div>
      </header>
      <div class="notice">Bu panel salondaki sunucudan eşitlenen verileri gösterir. Rezervasyonlar burada yalnızca talep olarak alınır; salonda onaylanınca kesinleşir.</div>
      <div class="stats" id="stats"></div>
      <div class="split">
        <div class="card"><h2>Yaklaşan etkinlikler</h2><table class="table compact"><tbody id="upcoming"></tbody></table></div>
        <div class="card"><h2>Stok</h2><table class="table compact"><tbody id="stock"></tbody></table></div>
      </div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  let halls = [];

  async function load() {
    const [s, stock] = await Promise.all([api('/cloud/summary', { query: { date: $('#date').value } }), api('/cloud/stock')]);
    halls = await api('/cloud/halls');
    const last = s.devices.map((d) => `${esc(d.origin)}: ${dateTimeTR(d.last_received_at)}`).join(' · ') || 'henüz veri yok';
    $('#stats').innerHTML = [
      ['Satış adedi', s.sales.count],
      ['Ciro', tl(s.sales.total)],
      ...s.by_method.map((m) => [METHOD_LABELS[m.method] ?? m.method, tl(m.total)]),
      ['Bekleyen talep', s.pending_requests],
      ['Son eşitleme', last],
    ]
      .map(([k, v]) => `<div class="stat card"><small>${k}</small><strong>${v}</strong></div>`)
      .join('');
    $('#upcoming').innerHTML = s.upcoming.length
      ? s.upcoming
          .map((r) => `<tr><td>${dateTR(r.event_date)}</td><td>${r.start_time}</td><td>${esc(r.hall_name ?? '')}</td><td>${esc(r.customer_name ?? '')}</td><td><span class="badge st-${r.status}">${STATUS_LABELS[r.status] ?? r.status}</span></td></tr>`)
          .join('')
      : emptyRow(5, 'Yaklaşan etkinlik yok');
    $('#stock').innerHTML = stock.length
      ? stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${qty(p.stock_qty)}</td><td class="num">${tl(p.price_kurus)}</td></tr>`).join('')
      : emptyRow(3, 'Ürün yok');
  }

  $('#request').addEventListener('click', () => {
    if (!halls.length) return toast('Salon bilgisi henüz eşitlenmedi', 'error');
    modal({
      title: 'Rezervasyon talebi',
      body: `
        <div class="grid-2">
          <label>Salon<select name="hall_id">${halls.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
          <label>Tarih<input type="date" name="event_date" required /></label>
          <label>Başlangıç<input type="time" name="start_time" value="19:00" required /></label>
          <label>Bitiş<input type="time" name="end_time" value="00:00" required /></label>
          <label>Müşteri adı<input name="customer_name" required /></label>
          <label>Telefon<input name="customer_phone" type="tel" /></label>
          <label>Davetli sayısı<input name="guest_count" type="number" min="0" /></label>
        </div>
        <label>Notlar<textarea name="notes" rows="2"></textarea></label>`,
      onSubmit: async (f) => {
        await api('/cloud/reservation-requests', {
          method: 'POST',
          body: {
            hall_id: f.get('hall_id'),
            event_date: f.get('event_date'),
            start_time: f.get('start_time'),
            end_time: f.get('end_time'),
            customer_name: f.get('customer_name'),
            customer_phone: f.get('customer_phone') || null,
            guest_count: f.get('guest_count') ? Number(f.get('guest_count')) : null,
            notes: f.get('notes') || null,
          },
        });
        toast('Talep alındı; salon sunucusu bağlandığında resepsiyona düşecek');
        await load();
      },
    });
  });
  $('#date').addEventListener('change', () => load().catch(errorToast));
  await load().catch(errorToast);
}
