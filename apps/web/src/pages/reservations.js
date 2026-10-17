import { api } from '../services/api.js';
import { esc, tl, parseTL, toInput, dateTR, today, STATUS_LABELS, EVENT_TYPES } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/** Yeni/düzenle formu. Kaydedince onSaved(rezervasyon) çağrılır. */
export function reservationForm(r, halls, onSaved) {
  if (halls.length === 0) return toast('Önce Ayarlar > Salonlar bölümünden bir salon tanımlayın.', 'error');
  const isNew = !r.id;
  const m = modal({
    title: isNew ? 'Yeni rezervasyon' : 'Rezervasyonu düzenle',
    wide: true,
    submitLabel: isNew ? 'Kaydet ve aç' : 'Güncelle',
    body: `
      <fieldset><legend>Müşteri</legend>
        <div class="grid-2">
          <label>Ad soyad / çift<input name="customer_name" required value="${esc(r.customer_name ?? '')}" placeholder="Ayşe & Mehmet Yılmaz" /></label>
          <label>Telefon<input name="customer_phone" type="tel" value="${esc(r.customer_phone ?? '')}" placeholder="05xx xxx xx xx" /></label>
        </div>
      </fieldset>
      <fieldset><legend>Organizasyon</legend>
        <div class="grid-3">
          <label>Salon<select name="hall_id">${halls.map((x) => `<option value="${x.id}" ${x.id === r.hall_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label>Tür<select name="event_type">${Object.entries(EVENT_TYPES).map(([k, v]) => `<option value="${k}" ${k === (r.event_type ?? 'dugun') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Davetli sayısı<input name="guest_count" type="number" min="0" value="${r.guest_count ?? ''}" /></label>
          <label>Tarih<input type="date" name="event_date" required value="${r.event_date}" /></label>
          <label>Başlangıç<input type="time" name="start_time" required value="${r.start_time}" /></label>
          <label>Bitiş<input type="time" name="end_time" required value="${r.end_time}" /></label>
        </div>
        <p id="avail" class="avail"></p>
      </fieldset>
      <fieldset><legend>Durum ve ücret</legend>
        <div class="grid-3">
          <label>Durum<select name="status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Opsiyon bitiş<input type="date" name="option_until" value="${r.option_until ?? ''}" /></label>
          <label>Salon ücreti (₺)<input name="price" inputmode="decimal" value="${toInput(r.price_kurus)}" placeholder="0" /></label>
          <label>İndirim (₺)<input name="discount" inputmode="decimal" value="${toInput(r.discount_kurus)}" placeholder="0" /></label>
          <label>Planlanan kapora (₺)<input name="deposit" inputmode="decimal" value="${toInput(r.deposit_kurus)}" placeholder="0" /></label>
        </div>
        <p class="muted small">Menü, pasta, süsleme gibi kalemleri ve tahsilatları kayıttan sonra rezervasyon sayfasından eklersiniz. "Opsiyon" ve "Kesin" salonu kilitler; "Talep" kilitlemez.</p>
      </fieldset>
      <label>Notlar<textarea name="notes" rows="2">${esc(r.notes ?? '')}</textarea></label>`,
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
        option_until: f.get('option_until') || null,
        price_kurus: parseTL(f.get('price')),
        discount_kurus: parseTL(f.get('discount')),
        deposit_kurus: parseTL(f.get('deposit')),
        notes: f.get('notes') || null,
      };
      const saved = isNew
        ? await api('/reservations', { method: 'POST', body })
        : await api(`/reservations/${r.id}`, { method: 'PUT', body: { ...body, version: r.version } });
      toast('Rezervasyon kaydedildi');
      onSaved?.(saved);
    },
  });
  const check = async () => {
    const f = m.form;
    const out = f.querySelector('#avail');
    try {
      const res = await api('/reservations/availability', {
        query: { hall_id: f.hall_id.value, event_date: f.event_date.value, start_time: f.start_time.value, end_time: f.end_time.value, exclude_id: r.id },
      });
      out.className = `avail ${res.available ? 'ok' : 'bad'}`;
      out.innerHTML = res.available
        ? `${icon('check', 16)} Salon bu saatte müsait`
        : `${icon('alert', 16)} Çakışma: ${res.conflicts.map((c) => `${esc(c.customer_name)} ${c.start_time}-${c.end_time} (${STATUS_LABELS[c.status]})`).join(', ')}`;
    } catch {
      out.textContent = '';
    }
  };
  ['hall_id', 'event_date', 'start_time', 'end_time'].forEach((n) => m.form[n].addEventListener('change', check));
  m.form.status.addEventListener('change', () => {
    if (m.form.status.value === 'opsiyon' && !m.form.option_until.value) {
      const d = new Date(Date.now() + 7 * 86400000);
      m.form.option_until.value = d.toISOString().slice(0, 10);
    }
  });
  check();
}

export async function renderReservations(root, { user, query }) {
  const state = { month: today().slice(0, 7), halls: [], list: [], hall: '', status: '', view: 'takvim' };
  const canEdit = ['admin', 'resepsiyon'].includes(user.role);
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        <div class="actions">
          <div class="seg"><button data-view="takvim" class="active">${icon('calendar', 16)} Takvim</button><button data-view="liste">Liste</button></div>
          <button class="icon-btn" id="prev" aria-label="Önceki ay">‹</button>
          <strong id="month-label" class="month-label"></strong>
          <button class="icon-btn" id="next" aria-label="Sonraki ay">›</button>
          <button class="btn ghost small" id="this-month">Bugün</button>
        </div>
        <div class="actions">
          <select id="f-hall"><option value="">Tüm salonlar</option></select>
          <select id="f-status"><option value="">Tüm durumlar</option>${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          ${canEdit ? `<button class="btn primary" id="new">${icon('plus')} Yeni rezervasyon</button>` : ''}
        </div>
      </header>
      <div class="legend">${['talep', 'opsiyon', 'kesin', 'tamamlandi'].map((s) => `<span><i class="dot st-${s}"></i>${STATUS_LABELS[s]}</span>`).join('')}</div>
      <div id="calendar" class="calendar card"></div>
      <div id="list" class="card" hidden><table class="table">
        <thead><tr><th>Tarih</th><th>Müşteri</th><th>Salon</th><th>Tür</th><th class="num">Davetli</th><th class="num">Toplam</th><th class="num">Kalan</th><th>Durum</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
      <div id="month-sum" class="month-sum"></div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  const open = (id) => (window.location.hash = `#/rezervasyon/${id}`);

  async function load() {
    state.halls = await api('/halls');
    if ($('#f-hall').options.length === 1) {
      $('#f-hall').insertAdjacentHTML('beforeend', state.halls.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''));
    }
    state.list = await api('/reservations', { query: { ...monthRange(state.month), hall_id: state.hall, status: state.status } });
    const [y, m] = state.month.split('-').map(Number);
    $('#month-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    renderCalendar(y, m);
    const active = state.list.filter((r) => r.status !== 'iptal');
    $('#rows').innerHTML = state.list.length
      ? state.list
          .map(
            (r) => `
        <tr class="clickable ${r.status === 'iptal' ? 'muted' : ''}" data-open="${r.id}">
          <td>${dateTR(r.event_date)}<small class="block muted">${r.start_time}–${r.end_time}</small></td>
          <td><strong>${esc(r.customer_name)}</strong><small class="block muted">${esc(r.customer_phone ?? '')}</small></td>
          <td>${esc(r.hall_name)}</td>
          <td>${EVENT_TYPES[r.event_type] ?? esc(r.event_type)}</td>
          <td class="num">${r.guest_count ?? ''}</td>
          <td class="num">${tl(r.total_kurus)}</td>
          <td class="num ${r.balance_kurus > 0 && r.status !== 'iptal' ? 'warn-text' : ''}">${tl(r.balance_kurus)}</td>
          <td><span class="badge st-${r.status}">${STATUS_LABELS[r.status]}</span>${r.source === 'bulut' ? ' <span class="badge">uzaktan</span>' : ''}</td>
        </tr>`,
          )
          .join('')
      : emptyRow(8, 'Bu ay rezervasyon yok');
    $('#month-sum').innerHTML = `
      <span><strong>${active.filter((r) => ['kesin', 'tamamlandi'].includes(r.status)).length}</strong> kesin</span>
      <span><strong>${active.filter((r) => r.status === 'opsiyon').length}</strong> opsiyon</span>
      <span><strong>${active.filter((r) => r.status === 'talep').length}</strong> talep</span>
      <span>Sözleşme toplamı <strong>${tl(active.filter((r) => ['kesin', 'tamamlandi'].includes(r.status)).reduce((s, r) => s + r.total_kurus, 0))}</strong></span>
      <span>Açık bakiye <strong>${tl(active.reduce((s, r) => s + Math.max(0, r.balance_kurus), 0))}</strong></span>`;
  }

  function renderCalendar(y, m) {
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const byDate = {};
    for (const r of state.list) if (r.status !== 'iptal') (byDate[r.event_date] ??= []).push(r);
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<div class="day blank"></div>');
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const items = (byDate[date] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
      const wd = new Date(y, m - 1, d).getDay();
      cells.push(`
        <div class="day ${date === today() ? 'today' : ''} ${wd === 0 || wd === 6 ? 'weekend' : ''} ${date < today() ? 'past' : ''}" data-date="${date}" ${canEdit ? 'role="button" tabindex="0"' : ''}>
          <span class="dnum">${d}</span>
          ${items.map((r) => `<span class="ev st-${r.status}" data-open="${r.id}" title="${esc(r.customer_name)} · ${esc(r.hall_name)}">${r.start_time} ${esc(r.customer_name)}</span>`).join('')}
        </div>`);
    }
    $('#calendar').innerHTML = `<div class="dow">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<span>${d}</span>`).join('')}</div><div class="days">${cells.join('')}</div>`;
  }

  const newForm = (date) =>
    reservationForm({ event_date: date ?? today(), start_time: '19:00', end_time: '00:00', status: 'opsiyon' }, state.halls, (saved) => open(saved.id));

  root.addEventListener('click', (e) => {
    const ev = e.target.closest('[data-open]');
    if (ev) return open(ev.dataset.open);
    const day = e.target.closest('[data-date]');
    if (day && canEdit) return newForm(day.dataset.date);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'new') newForm();
    if (b.dataset.view) {
      state.view = b.dataset.view;
      root.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
      $('#calendar').hidden = state.view !== 'takvim';
      $('#list').hidden = state.view !== 'liste';
    }
    if (b.id === 'prev' || b.id === 'next' || b.id === 'this-month') {
      if (b.id === 'this-month') state.month = today().slice(0, 7);
      else {
        const [y, m] = state.month.split('-').map(Number);
        const d = new Date(y, m - 1 + (b.id === 'next' ? 1 : -1), 1);
        state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      load().catch(errorToast);
    }
  });
  $('#f-hall').addEventListener('change', (e) => ((state.hall = e.target.value), load().catch(errorToast)));
  $('#f-status').addEventListener('change', (e) => ((state.status = e.target.value), load().catch(errorToast)));
  await load().catch(errorToast);
  if (query?.get('yeni') && canEdit) newForm();
}
