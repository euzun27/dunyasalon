import { api } from '../services/api.js';
import { esc, tl, parseTL, toInput, dateShort, today, EVENT_TYPES } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';

export async function renderStaff(root, { user }) {
  const canEdit = ['admin', 'muhasebe'].includes(user.role);
  let list = [];
  let showInactive = false;

  root.append(
    h(`
    <div class="page">
      <div class="page-head">
        <label class="check"><input type="checkbox" id="inactive"> Ayrılanları da göster</label>
        ${canEdit ? `<button class="btn primary" id="add">${icon('plus', 16)} Personel ekle</button>` : ''}
      </div>
      <section class="card">
        <table class="table">
          <thead><tr><th>Personel</th><th>Görev</th><th>Telefon</th><th class="num">Yevmiye</th><th class="num">Yaklaşan etkinlik</th><th class="num">Bu ay hakediş</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </section>
      <p class="muted small">Personel, rezervasyon ayrıntısındaki "Personel" sekmesinden etkinliğe atanır; atanan yevmiye o etkinliğin maliyetine ve finans raporuna gider olarak yazılır.</p>
    </div>`),
  );
  const rows = root.querySelector('#rows');

  async function load() {
    try {
      list = await api('/staff', { query: { all: showInactive ? 1 : undefined } });
      rows.innerHTML = list.length
        ? list
            .map(
              (s) => `
          <tr class="${s.active ? '' : 'muted'}">
            <td><div class="person"><span class="avatar sm">${esc(s.full_name.slice(0, 1).toLocaleUpperCase('tr'))}</span><strong>${esc(s.full_name)}</strong>${s.active ? '' : ' <span class="badge">Ayrıldı</span>'}</div></td>
            <td>${esc(s.title ?? '')}</td>
            <td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''}</td>
            <td class="num">${tl(s.daily_wage_kurus)}</td>
            <td class="num">${s.upcoming_events}</td>
            <td class="num">${tl(s.month_wage_kurus)}</td>
            <td class="row-actions">
              <button class="btn small ghost" data-schedule="${s.id}">${icon('calendar', 14)} Program</button>
              ${canEdit ? `<button class="icon-btn ghost" data-edit="${s.id}" title="Düzenle">${icon('edit', 16)}</button>` : ''}
            </td>
          </tr>`,
            )
            .join('')
        : emptyRow(7, 'Henüz personel eklenmedi.');
    } catch (e) {
      errorToast(e);
    }
  }

  function edit(s) {
    modal({
      title: s ? 'Personeli düzenle' : 'Yeni personel',
      body: `
        <div class="grid-2">
          <label>Ad soyad<input name="full_name" required value="${esc(s?.full_name ?? '')}"></label>
          <label>Görev<input name="title" list="titles" value="${esc(s?.title ?? '')}" placeholder="Garson, aşçı, DJ…"></label>
          <label>Telefon<input name="phone" type="tel" value="${esc(s?.phone ?? '')}"></label>
          <label>Yevmiye (₺)<input name="wage" inputmode="decimal" value="${toInput(s?.daily_wage_kurus)}" placeholder="0"></label>
        </div>
        ${s ? `<label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Aktif çalışıyor</label>` : ''}
        <datalist id="titles">${['Garson', 'Komi', 'Aşçı', 'Bulaşıkçı', 'Temizlik', 'Güvenlik', 'DJ', 'Organizatör', 'Kasiyer'].map((t) => `<option value="${t}">`).join('')}</datalist>`,
      onSubmit: async (fd) => {
        await api(s ? `/staff/${s.id}` : '/staff', {
          method: s ? 'PUT' : 'POST',
          body: {
            full_name: fd.get('full_name'),
            title: fd.get('title'),
            phone: fd.get('phone'),
            daily_wage_kurus: parseTL(fd.get('wage')),
            active: s ? fd.get('active') === 'on' : true,
          },
        });
        toast('Kaydedildi');
        await load();
      },
    });
  }

  async function schedule(s) {
    try {
      const items = await api(`/staff/${s.id}/schedule`);
      const t = today();
      modal({
        title: `${s.full_name} · etkinlik programı`,
        wide: true,
        body: `<table class="table compact">
          <thead><tr><th>Tarih</th><th>Etkinlik</th><th>Görev</th><th class="num">Yevmiye</th></tr></thead>
          <tbody>${
            items.length
              ? items
                  .map(
                    (i) => `<tr class="${i.event_date < t ? 'muted' : ''}"><td>${dateShort(i.event_date)} <small class="muted">${i.start_time}</small></td>
                      <td><a href="#/rezervasyon/${i.reservation_id}">${esc(i.customer_name)}</a><small class="block muted">${EVENT_TYPES[i.event_type] ?? ''} · ${esc(i.hall_name)}</small></td>
                      <td>${esc(i.task ?? '')}</td><td class="num">${tl(i.wage_kurus)}</td></tr>`,
                  )
                  .join('')
              : emptyRow(4, 'Atanmış etkinlik yok.')
          }</tbody></table>`,
      });
    } catch (e) {
      errorToast(e);
    }
  }

  root.querySelector('#inactive').addEventListener('change', (e) => {
    showInactive = e.target.checked;
    load();
  });
  root.querySelector('#add')?.addEventListener('click', () => edit(null));
  rows.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(list.find((s) => s.id === ed.dataset.edit));
    const sc = e.target.closest('[data-schedule]');
    if (sc) schedule(list.find((s) => s.id === sc.dataset.schedule));
  });
  await load();
}
