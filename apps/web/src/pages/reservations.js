import { api } from '../services/api.js';
import { esc, tl, parseTL, dateTR, today, STATUS_LABELS } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export async function renderReservations(root, { user }) {
  const state = { month: today().slice(0, 7), halls: [], list: [] };
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        <h1>Rezervasyonlar</h1>
        <div class="actions">
          <button class="icon-btn" id="prev" aria-label="Önceki ay">‹</button>
          <strong id="month-label" class="month-label"></strong>
          <button class="icon-btn" id="next" aria-label="Sonraki ay">›</button>
          ${user.role === 'admin' ? '<button class="btn ghost" id="new-hall">+ Salon</button>' : ''}
          <button class="btn primary" id="new">+ Yeni rezervasyon</button>
        </div>
      </header>
      <div id="calendar" class="calendar card"></div>
      <div class="card"><table class="table">
        <thead><tr><th>Tarih</th><th>Saat</th><th>Salon</th><th>Müşteri</th><th class="num">Davetli</th><th class="num">Ücret</th><th>Durum</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);

  async function load() {
    state.halls = await api('/halls');
    state.list = await api('/reservations', { query: monthRange(state.month) });
    const [y, m] = state.month.split('-').map(Number);
    $('#month-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    renderCalendar(y, m);
    $('#rows').innerHTML = state.list.length
      ? state.list
          .map(
            (r) => `
        <tr class="${r.status === 'iptal' ? 'muted' : ''}">
          <td>${dateTR(r.event_date)}</td>
          <td>${r.start_time}–${r.end_time}</td>
          <td>${esc(r.hall_name)}</td>
          <td>${esc(r.customer_name)}<small class="block muted">${esc(r.customer_phone ?? '')}</small></td>
          <td class="num">${r.guest_count ?? ''}</td>
          <td class="num">${tl(r.price_kurus)}</td>
          <td><span class="badge st-${r.status}">${STATUS_LABELS[r.status]}</span>${r.source === 'bulut' ? ' <span class="badge">uzaktan</span>' : ''}</td>
          <td class="row-actions"><button class="btn ghost small" data-edit="${r.id}">Aç</button></td>
        </tr>`,
          )
          .join('')
      : emptyRow(8, 'Bu ay rezervasyon yok');
  }

  function renderCalendar(y, m) {
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // Pazartesi başlangıç
    const byDate = {};
    for (const r of state.list) if (r.status !== 'iptal') (byDate[r.event_date] ??= []).push(r);
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<div class="day blank"></div>');
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const items = byDate[date] ?? [];
      cells.push(`
        <button class="day ${date === today() ? 'today' : ''}" data-date="${date}">
          <span class="dnum">${d}</span>
          ${items.map((r) => `<span class="ev st-${r.status}" data-edit="${r.id}">${r.start_time} ${esc(r.hall_name)} · ${esc(r.customer_name)}</span>`).join('')}
        </button>`);
    }
    $('#calendar').innerHTML = `<div class="dow">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<span>${d}</span>`).join('')}</div><div class="days">${cells.join('')}</div>`;
  }

  function form(r = { event_date: today(), start_time: '19:00', end_time: '00:00', status: 'opsiyon' }) {
    if (state.halls.length === 0) return toast('Önce bir salon tanımlayın (yönetici).', 'error');
    const m = modal({
      title: r.id ? 'Rezervasyon' : 'Yeni rezervasyon',
      wide: true,
      submitLabel: r.id ? 'Güncelle' : 'Kaydet',
      body: `
        <div class="grid-2">
          <label>Salon<select name="hall_id">${state.halls.map((x) => `<option value="${x.id}" ${x.id === r.hall_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label>Etkinlik türü<select name="event_type">${['dugun', 'nisan', 'kina', 'sunnet', 'diger']
            .map((t) => `<option value="${t}" ${t === (r.event_type ?? 'dugun') ? 'selected' : ''}>${{ dugun: 'Düğün', nisan: 'Nişan', kina: 'Kına', sunnet: 'Sünnet', diger: 'Diğer' }[t]}</option>`)
            .join('')}</select></label>
          <label>Tarih<input type="date" name="event_date" required value="${r.event_date}" /></label>
          <div class="grid-2 tight">
            <label>Başlangıç<input type="time" name="start_time" required value="${r.start_time}" /></label>
            <label>Bitiş<input type="time" name="end_time" required value="${r.end_time}" /></label>
          </div>
          <label>Müşteri adı<input name="customer_name" required value="${esc(r.customer_name ?? '')}" /></label>
          <label>Telefon<input name="customer_phone" type="tel" value="${esc(r.customer_phone ?? '')}" /></label>
          <label>Davetli sayısı<input name="guest_count" type="number" min="0" value="${r.guest_count ?? ''}" /></label>
          <label>Durum<select name="status">${Object.entries(STATUS_LABELS)
            .map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`)
            .join('')}</select></label>
          <label>Ücret (₺)<input name="price" inputmode="decimal" value="${r.price_kurus ? (r.price_kurus / 100).toFixed(2).replace('.', ',') : ''}" /></label>
          <label>Kapora (₺)<input name="deposit" inputmode="decimal" value="${r.deposit_kurus ? (r.deposit_kurus / 100).toFixed(2).replace('.', ',') : ''}" /></label>
        </div>
        <label>Notlar<textarea name="notes" rows="3">${esc(r.notes ?? '')}</textarea></label>
        <p id="avail" class="avail"></p>
        <p class="muted small">"Opsiyon" ve "Kesin" salonu kilitler; "Talep" kilitlemez. Kesinleşen rezervasyon için düğün hesabı otomatik açılır.</p>`,
      onSubmit: async (f) => {
        const body = {
          hall_id: f.get('hall_id'),
          event_type: f.get('event_type'),
          event_date: f.get('event_date'),
          start_time: f.get('start_time'),
          end_time: f.get('end_time'),
          customer_name: f.get('customer_name'),
          customer_phone: f.get('customer_phone') || null,
          guest_count: f.get('guest_count') ? Number(f.get('guest_count')) : null,
          status: f.get('status'),
          price_kurus: parseTL(f.get('price')),
          deposit_kurus: parseTL(f.get('deposit')),
          notes: f.get('notes') || null,
        };
        if (r.id) await api(`/reservations/${r.id}`, { method: 'PUT', body: { ...body, version: r.version } });
        else await api('/reservations', { method: 'POST', body });
        toast('Rezervasyon kaydedildi');
        await load();
      },
    });
    const check = async () => {
      const f = m.form;
      const out = m.form.querySelector('#avail');
      try {
        const res = await api('/reservations/availability', {
          query: { hall_id: f.hall_id.value, event_date: f.event_date.value, start_time: f.start_time.value, end_time: f.end_time.value, exclude_id: r.id },
        });
        out.className = `avail ${res.available ? 'ok' : 'bad'}`;
        out.textContent = res.available
          ? '✓ Salon bu saatte müsait'
          : `✕ Çakışma: ${res.conflicts.map((c) => `${c.customer_name} ${c.start_time}-${c.end_time} (${STATUS_LABELS[c.status]})`).join(', ')}`;
      } catch {
        out.textContent = '';
      }
    };
    ['hall_id', 'event_date', 'start_time', 'end_time'].forEach((n) => m.form[n].addEventListener('change', check));
    check();
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-edit], [data-date], button');
    if (!el) return;
    if (el.dataset.edit) {
      e.stopPropagation();
      return form(state.list.find((r) => r.id === el.dataset.edit));
    }
    if (el.dataset.date) return form({ event_date: el.dataset.date, start_time: '19:00', end_time: '00:00', status: 'opsiyon' });
    if (el.id === 'new') form();
    if (el.id === 'prev' || el.id === 'next') {
      const [y, m] = state.month.split('-').map(Number);
      const d = new Date(y, m - 1 + (el.id === 'next' ? 1 : -1), 1);
      state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      load().catch(errorToast);
    }
    if (el.id === 'new-hall') {
      modal({
        title: 'Yeni salon',
        body: '<label>Salon adı<input name="name" required /></label><label>Kapasite<input name="capacity" type="number" min="1" /></label>',
        onSubmit: async (f) => {
          await api('/halls', { method: 'POST', body: { name: f.get('name'), capacity: f.get('capacity') ? Number(f.get('capacity')) : null } });
          await load();
        },
      });
    }
  });
  await load().catch(errorToast);
}
