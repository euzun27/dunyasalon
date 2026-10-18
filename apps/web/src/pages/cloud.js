import { api } from '../services/api.js';
import { esc, tl, today, dateTR, dateTimeTR, STATUS_LABELS, METHOD_LABELS, EVENT_TYPES } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { hallTable } from './reports.js';

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
      <div class="page-flow">
        <div class="card"><h2>Yaklaşan etkinlikler</h2><div class="table-wrap"><table class="table compact">
          <thead><tr><th>Tarih</th><th>Müşteri</th><th>Durum</th><th class="num">Toplam</th><th class="num">Tahsil</th><th class="num">Kalan</th></tr></thead>
          <tbody id="upcoming"></tbody></table></div></div>
        <div class="card"><header class="card-head"><h2>Kantin hesapları (cari)</h2>
          <select id="acc-filter" style="width:auto"><option value="acik">Açık hesaplar</option><option value="kapali">Kapalı hesaplar</option><option value="">Tümü</option></select></header>
          <div class="table-wrap"><table class="table compact">
          <thead><tr><th>Hesap</th><th>Son hareket</th><th class="num">Borç</th><th class="num">Tahsilat</th><th class="num">Kalan borç</th></tr></thead>
          <tbody id="accounts"></tbody><tfoot id="accounts-total"></tfoot></table></div></div>
        <div class="card"><header class="card-head"><h2 id="hall-title">Salonlara göre</h2><a class="btn ghost small" href="#/bulut-raporlar">Tüm raporlar</a></header><div id="halls"></div></div>
      </div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  let halls = [];
  const sum = (rows, k) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);

  async function loadAccounts() {
    // En çok borcu olan en üstte
    const list = (await api('/cloud/event-accounts', { query: { status: $('#acc-filter').value } })).sort((a, b) => b.balance_kurus - a.balance_kurus);
    $('#accounts').innerHTML = list.length
      ? list
          .map(
            (a) => `<tr class="clickable" data-acc="${a.id}"><td>${esc(a.title)}${a.status === 'kapali' ? ' <span class="badge">kapalı</span>' : ''}
                <small class="block muted">${a.event_date ? `Etkinlik ${dateTR(a.event_date)}` : ''}</small></td>
              <td>${a.last_entry_at ? dateTimeTR(a.last_entry_at) : '-'}</td>
              <td class="num">${tl(a.debit_kurus)}</td><td class="num">${tl(a.credit_kurus)}</td>
              <td class="num ${a.balance_kurus > 0 ? 'warn-text' : 'ok-text'}"><strong>${tl(a.balance_kurus)}</strong></td></tr>`,
          )
          .join('')
      : emptyRow(5, 'Hesap yok');
    $('#accounts-total').innerHTML = list.length > 1
      ? `<tr><th>Toplam</th><th></th><th class="num">${tl(sum(list, 'debit_kurus'))}</th><th class="num">${tl(sum(list, 'credit_kurus'))}</th><th class="num">${tl(sum(list, 'balance_kurus'))}</th></tr>`
      : '';
    return list;
  }

  async function showAccount(id) {
    const a = await api(`/cloud/event-accounts/${id}`);
    modal({
      title: a.title,
      body: `<p class="muted small">Borç ${tl(a.debit_kurus)} · Tahsilat ${tl(a.credit_kurus)} · <strong>Bakiye ${tl(a.balance_kurus)}</strong></p>
        <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Borç</th><th class="num">Alacak</th></tr></thead>
        <tbody>${
          a.ledger.length
            ? a.ledger
                .map(
                  (l) => `<tr><td>${dateTimeTR(l.created_at)}</td><td>${esc(l.description)}</td>
                  <td class="num">${l.entry_type === 'borc' ? tl(l.amount_kurus) : ''}</td>
                  <td class="num">${l.entry_type === 'alacak' ? tl(l.amount_kurus) : ''}</td></tr>`,
                )
                .join('')
            : emptyRow(4, 'Hareket yok')
        }</tbody></table></div>`,
      wide: true,
    });
  }

  async function load() {
    const year = $('#date').value.slice(0, 4);
    const [s, report] = await Promise.all([api('/cloud/summary', { query: { date: $('#date').value } }), api('/cloud/reports/yearly', { query: { year } })]);
    halls = await api('/cloud/halls');
    const openAccounts = await api('/cloud/event-accounts', { query: { status: 'acik' } });
    await loadAccounts();
    const last = s.devices.map((d) => `${dateTimeTR(d.last_received_at)} <small class="block muted">${esc(d.origin)}</small>`).join('') || 'henüz veri yok';
    $('#stats').innerHTML = [
      ['Rezervasyon tahsilatı', tl(s.reservation_payments.total)],
      ['Açık alacak', `${tl(s.receivable.total)} <small class="muted">${s.receivable.count} etkinlik</small>`],
      ['Toplam kantin borcu (cari)', `${tl(sum(openAccounts, 'balance_kurus'))} <small class="muted">${openAccounts.length} açık hesap</small>`],
      ['Kantin satış adedi (gün)', s.sales.count],
      ['Kantin cirosu (gün)', tl(s.sales.total)],
      ...s.by_method.map((m) => [METHOD_LABELS[m.method] ?? m.method, tl(m.total)]),
      ['Bekleyen talep', s.pending_requests],
      ['Son eşitleme', last],
    ]
      .map(([k, v]) => `<div class="stat card"><small>${esc(k)}</small><strong>${v}</strong></div>`)
      .join('');
    $('#upcoming').innerHTML = s.upcoming.length
      ? s.upcoming
          .map(
            (r) => `<tr><td>${dateTR(r.event_date)}<small class="block muted">${r.start_time} · ${esc(r.hall_name ?? '')}</small></td>
              <td>${esc(r.customer_name ?? '')}<small class="block muted">${EVENT_TYPES[r.event_type] ?? esc(r.event_type ?? '')}${r.guest_count ? ` · ${r.guest_count} kişi` : ''}</small></td>
              <td><span class="badge st-${r.status}">${STATUS_LABELS[r.status] ?? r.status}</span></td>
              <td class="num">${tl(r.total_kurus)}</td><td class="num">${tl(r.paid_kurus)}</td>
              <td class="num ${r.balance_kurus > 0 ? 'warn-text' : 'ok-text'}"><strong>${tl(r.balance_kurus)}</strong></td></tr>`,
          )
          .join('')
      : emptyRow(6, 'Yaklaşan etkinlik yok');
    $('#hall-title').textContent = `Salonlara göre · ${year}`;
    $('#halls').innerHTML = hallTable(report.by_hall);
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
  $('#acc-filter').addEventListener('change', () => loadAccounts().catch(errorToast));
  root.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-acc]');
    if (row) showAccount(row.dataset.acc).catch(errorToast);
  });
  await load().catch(errorToast);
}
