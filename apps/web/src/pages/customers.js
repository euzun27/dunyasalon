import { api } from '../services/api.js';
import { esc, tl, dateShort, dateTimeTR, today, STATUS_LABELS, EVENT_TYPES } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';

export async function renderCustomers(root) {
  root.append(
    h(`
    <div class="page">
      <div class="page-head">
        <div class="actions">
          <div class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Ad soyad veya telefon ara…" autocomplete="off"></div>
        </div>
        <a class="btn primary" href="#/rezervasyon?yeni=1">${icon('plus', 16)} Yeni rezervasyon</a>
      </div>
      <section class="card">
        <table class="table">
          <thead><tr><th>Müşteri</th><th>Telefon</th><th class="num">Etkinlik</th><th>Sıradaki etkinlik</th><th>Son etkinlik</th><th></th></tr></thead>
          <tbody id="rows"><tr><td colspan="6" class="empty">Yükleniyor…</td></tr></tbody>
        </table>
      </section>
      <p class="muted small">Müşteri kaydı rezervasyon oluştururken otomatik açılır. Kart üzerinden adres, T.C. kimlik no ve görüşme notları eklenebilir.</p>
    </div>`),
  );
  const rows = root.querySelector('#rows');
  let timer;

  async function load(q = '') {
    try {
      const list = await api('/customers', { query: { q } });
      const t = today();
      rows.innerHTML = list.length
        ? list
            .map(
              (c) => `
          <tr class="clickable" data-id="${c.id}">
            <td><div class="person"><span class="avatar sm">${esc(c.full_name.slice(0, 1).toLocaleUpperCase('tr'))}</span><div><strong>${esc(c.full_name)}</strong>${c.email ? `<small class="block muted">${esc(c.email)}</small>` : ''}</div></div></td>
            <td>${c.phone ? esc(c.phone) : '<span class="muted">—</span>'}</td>
            <td class="num">${c.event_count}</td>
            <td>${c.next_event ? `<span class="badge ${c.next_event === t ? 'warn' : 'ok'}">${dateShort(c.next_event)}</span>` : '<span class="muted">—</span>'}</td>
            <td>${c.last_event ? dateShort(c.last_event) : '<span class="muted">—</span>'}</td>
            <td class="row-actions"><span class="muted">${icon('chevron', 16)}</span></td>
          </tr>`,
            )
            .join('')
        : emptyRow(6, q ? 'Aramaya uyan müşteri yok.' : 'Henüz müşteri yok. İlk rezervasyonla birlikte eklenir.');
    } catch (e) {
      errorToast(e);
    }
  }

  root.querySelector('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value.trim()), 250);
  });
  rows.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) window.location.hash = `#/musteri/${tr.dataset.id}`;
  });
  await load();
  return () => clearTimeout(timer);
}

export async function renderCustomerDetail(root, { user, params, setTitle }) {
  const id = params[0];
  const canEdit = ['admin', 'resepsiyon'].includes(user.role);
  let c;

  async function load() {
    c = await api(`/customers/${id}`);
    render();
  }

  function render() {
    setTitle(c.full_name);
    root.innerHTML = '';
    root.append(
      h(`
      <div class="page">
        <a href="#/musteriler" class="back">${icon('back', 16)} Müşteriler</a>
        <section class="card res-head">
          <div class="res-title">
            <span class="avatar lg">${esc(c.full_name.slice(0, 1).toLocaleUpperCase('tr'))}</span>
            <div>
              <h2>${esc(c.full_name)}</h2>
              <p class="muted small">
                ${c.phone ? `<a href="tel:${esc(c.phone)}">${icon('phone', 14)} ${esc(c.phone)}</a>` : 'Telefon yok'}
                ${c.email ? ` · ${esc(c.email)}` : ''}
                ${c.national_id ? ` · T.C. ${esc(c.national_id)}` : ''}
              </p>
              ${c.address ? `<p class="muted small">${esc(c.address)}</p>` : ''}
            </div>
          </div>
          <div class="actions">
            ${canEdit ? `<button class="btn ghost" id="edit">Bilgileri düzenle</button>` : ''}
            ${canEdit ? `<a class="btn primary" href="#/rezervasyon?yeni=1">${icon('plus', 16)} Yeni rezervasyon</a>` : ''}
          </div>
        </section>

        <section class="money">
          <div class="money-cell"><small>Etkinlik</small><strong>${c.reservations.filter((r) => r.status !== 'iptal').length}</strong></div>
          <div class="money-cell"><small>Toplam sözleşme</small><strong>${tl(c.total_kurus)}</strong></div>
          <div class="money-cell ok"><small>Ödenen</small><strong>${tl(c.paid_kurus)}</strong></div>
          <div class="money-cell ${c.balance_kurus > 0 ? 'warn' : 'ok'}"><small>Kalan</small><strong>${tl(c.balance_kurus)}</strong></div>
        </section>

        <div class="grid-main">
          <section class="card">
            <header class="card-head"><h3>${icon('calendar')} Organizasyonları</h3></header>
            ${
              c.reservations.length
                ? `<div class="event-list">${c.reservations
                    .map(
                      (r) => `
                <a class="event-row" href="#/rezervasyon/${r.id}">
                  <div class="date-chip"><strong>${r.event_date.slice(8, 10)}</strong><small>${new Date(r.event_date + 'T00:00:00').toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' })}</small></div>
                  <div class="grow"><strong>${EVENT_TYPES[r.event_type] ?? esc(r.event_type)}</strong><small class="muted block">${esc(r.hall_name)} · ${r.start_time}–${r.end_time}${r.guest_count ? ` · ${r.guest_count} kişi` : ''}</small></div>
                  <div class="right"><span class="badge st-${r.status}">${STATUS_LABELS[r.status]}</span>
                    <small class="block ${r.balance_kurus > 0 ? 'warn-text' : 'ok-text'}">${r.balance_kurus > 0 ? 'Kalan ' + tl(r.balance_kurus) : tl(r.total_kurus)}</small></div>
                </a>`,
                    )
                    .join('')}</div>`
                : '<p class="empty">Rezervasyon yok.</p>'
            }
          </section>
          <div class="stack">
            <section class="card">
              <header class="card-head"><h3>${icon('note')} Notlar</h3></header>
              <form id="note-form" class="note-form"><textarea name="note" rows="2" placeholder="Görüşme notu ekleyin…" required></textarea><button class="btn primary">Ekle</button></form>
              <ul class="timeline">${
                c.notes.length
                  ? c.notes.map((n) => `<li><small class="muted">${dateTimeTR(n.created_at)} · ${esc(n.user_name ?? '')}</small><p>${esc(n.note)}</p></li>`).join('')
                  : '<li class="empty">Henüz not yok.</li>'
              }</ul>
            </section>
            <section class="card">
              <header class="card-head"><h3>${icon('whatsapp')} Gönderilen mesajlar</h3></header>
              ${
                c.messages.length
                  ? `<ul class="timeline">${c.messages
                      .map((m) => `<li><small class="muted">${dateTimeTR(m.created_at)} · ${esc(m.channel)}</small><p>${esc(m.body)}</p></li>`)
                      .join('')}</ul>`
                  : '<p class="empty">Mesaj gönderilmedi.</p>'
              }
            </section>
          </div>
        </div>
        ${c.general_note ? `<p class="muted small"><strong>Genel not:</strong> ${esc(c.general_note)}</p>` : ''}
      </div>`),
    );
  }

  root.addEventListener('submit', async (e) => {
    if (e.target.id !== 'note-form') return;
    e.preventDefault();
    const note = new FormData(e.target).get('note');
    try {
      await api('/customer-notes', { method: 'POST', body: { customer_id: id, note } });
      toast('Not eklendi');
      await load();
    } catch (err) {
      errorToast(err);
    }
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('#edit')) editCustomer();
  });

  function editCustomer() {
    modal({
      title: 'Müşteri bilgileri',
      wide: true,
      body: `
        <div class="grid-2">
          <label>Ad soyad<input name="full_name" required value="${esc(c.full_name)}"></label>
          <label>Telefon<input name="phone" type="tel" value="${esc(c.phone ?? '')}" placeholder="0532 000 00 00"></label>
          <label>E-posta<input name="email" type="email" value="${esc(c.email ?? '')}"></label>
          <label>T.C. kimlik no<input name="national_id" inputmode="numeric" maxlength="11" value="${esc(c.national_id ?? '')}"></label>
        </div>
        <label>Adres<textarea name="address" rows="2">${esc(c.address ?? '')}</textarea></label>
        <label>Genel not<textarea name="notes" rows="2">${esc(c.general_note ?? '')}</textarea></label>
        <p class="muted small">Adres ve T.C. kimlik no sözleşmede kullanılır.</p>`,
      onSubmit: async (fd) => {
        await api(`/customers/${id}`, { method: 'PUT', body: Object.fromEntries(fd) });
        toast('Müşteri güncellendi');
        await load();
      },
    });
  }

  try {
    await load();
  } catch (e) {
    errorToast(e);
  }
}
