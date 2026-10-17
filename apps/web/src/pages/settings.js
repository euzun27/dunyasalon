import { api, session } from '../services/api.js';
import { esc, dateShort } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';

const TABS = [
  ['isletme', 'İşletme bilgileri'],
  ['sozlesme', 'Sözleşme maddeleri'],
  ['mesaj', 'Mesaj şablonları'],
  ['kullanici', 'Kullanıcılar'],
  ['salon', 'Salonlar'],
];
const ROLES = { admin: 'Yönetici', resepsiyon: 'Resepsiyon', muhasebe: 'Muhasebe', kasiyer: 'Kasiyer' };
const ROLE_HINTS = {
  admin: 'Her şey',
  resepsiyon: 'Rezervasyon, müşteri, tahsilat',
  muhasebe: 'Finans, rapor, hizmet ve personel tanımı',
  kasiyer: 'Kantin kasası ve stok',
};
const PLACEHOLDERS = ['{musteri}', '{tarih}', '{saat}', '{salon}', '{etkinlik}', '{toplam}', '{odenen}', '{kalan}', '{opsiyon_bitis}', '{tutar}', '{makbuz}', '{isletme}', '{isletme_tel}'];

export async function renderSettings(root, { query }) {
  let tab = TABS.some(([k]) => k === query.get('sekme')) ? query.get('sekme') : 'isletme';
  root.append(
    h(`
    <div class="page">
      <nav class="tabs" id="tabs">${TABS.map(([k, v]) => `<button data-tab="${k}">${v}</button>`).join('')}</nav>
      <section class="card tab-body" id="body"></section>
    </div>`),
  );
  const body = root.querySelector('#body');

  async function show() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    body.innerHTML = '<p class="empty">Yükleniyor…</p>';
    try {
      if (tab === 'isletme') await business();
      else if (tab === 'sozlesme') await contract();
      else if (tab === 'mesaj') await templates();
      else if (tab === 'kullanici') await users();
      else await halls();
    } catch (e) {
      errorToast(e);
    }
  }

  async function business() {
    const s = await api('/settings');
    body.innerHTML = `
      <form id="biz" class="form-narrow">
        <p class="muted small">Bu bilgiler sözleşme, makbuz ve müşteriye giden mesajlarda kullanılır.</p>
        <label>İşletme adı<input name="business.name" value="${esc(s['business.name'] ?? '')}" required></label>
        <div class="grid-2">
          <label>Telefon<input name="business.phone" value="${esc(s['business.phone'] ?? '')}"></label>
          <label>Vergi dairesi / no<input name="business.tax" value="${esc(s['business.tax'] ?? '')}"></label>
        </div>
        <label>Adres<textarea name="business.address" rows="2">${esc(s['business.address'] ?? '')}</textarea></label>
        <div><button class="btn primary">Kaydet</button></div>
      </form>`;
    body.querySelector('#biz').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
        toast('İşletme bilgileri kaydedildi');
      } catch (err) {
        errorToast(err);
      }
    });
  }

  async function contract() {
    const s = await api('/settings');
    body.innerHTML = `
      <form id="terms" class="form-narrow">
        <p class="muted small">Her satır sözleşmede ayrı bir madde olarak numaralandırılır.</p>
        <textarea name="contract.terms" rows="14">${esc(s['contract.terms'] ?? '')}</textarea>
        <div><button class="btn primary">Kaydet</button></div>
      </form>`;
    body.querySelector('#terms').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
        toast('Sözleşme maddeleri kaydedildi');
      } catch (err) {
        errorToast(err);
      }
    });
  }

  async function templates() {
    const list = await api('/message-templates');
    body.innerHTML = `
      <p class="muted small">Rezervasyon ekranındaki "Mesaj" düğmesi bu şablonları doldurup WhatsApp veya SMS ile gönderir. Kullanılabilir alanlar:
        ${PLACEHOLDERS.map((p) => `<code>${p}</code>`).join(' ')}</p>
      <div class="page-flow">${list
        .map(
          (t) => `
        <form class="tpl" data-key="${esc(t.key)}">
          <label>${esc(t.title)}<textarea name="body" rows="3">${esc(t.body)}</textarea></label>
          <div><button class="btn small primary">Kaydet</button></div>
        </form>`,
        )
        .join('')}</div>`;
    body.querySelectorAll('form.tpl').forEach((f) =>
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/message-templates/${f.dataset.key}`, { method: 'PUT', body: { body: new FormData(f).get('body') } });
          toast('Şablon kaydedildi');
        } catch (err) {
          errorToast(err);
        }
      }),
    );
  }

  async function users() {
    const list = await api('/users');
    const me = session.user?.id;
    body.innerHTML = `
      <header class="card-head"><h3>${icon('users')} Kullanıcılar</h3><button class="btn primary" id="add-user">${icon('plus', 16)} Kullanıcı ekle</button></header>
      <table class="table">
        <thead><tr><th>Ad soyad</th><th>Kullanıcı adı</th><th>Rol</th><th>Durum</th><th>Eklenme</th><th></th></tr></thead>
        <tbody>${list
          .map(
            (u) => `
          <tr class="${u.active ? '' : 'muted'}">
            <td><div class="person"><span class="avatar sm">${esc(u.full_name.slice(0, 1).toLocaleUpperCase('tr'))}</span><strong>${esc(u.full_name)}</strong>${u.id === me ? ' <span class="badge">Siz</span>' : ''}</div></td>
            <td class="mono">${esc(u.username)}</td>
            <td>${ROLES[u.role] ?? esc(u.role)}</td>
            <td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Pasif</span>'}</td>
            <td>${dateShort(u.created_at)}</td>
            <td class="row-actions"><button class="icon-btn ghost" data-user="${u.id}" title="Düzenle">${icon('edit', 16)}</button></td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
      <ul class="role-help">${Object.entries(ROLES).map(([k, v]) => `<li><strong>${v}:</strong> ${ROLE_HINTS[k]}</li>`).join('')}</ul>`;
    const roleSelect = (cur) => `<select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v} — ${ROLE_HINTS[k]}</option>`).join('')}</select>`;
    body.querySelector('#add-user').addEventListener('click', () =>
      modal({
        title: 'Yeni kullanıcı',
        body: `
          <label>Ad soyad<input name="full_name" required></label>
          <div class="grid-2">
            <label>Kullanıcı adı<input name="username" required autocomplete="off"></label>
            <label>Şifre<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
          </div>
          <label>Rol${roleSelect('resepsiyon')}</label>`,
        onSubmit: async (fd) => {
          await api('/users', { method: 'POST', body: Object.fromEntries(fd) });
          toast('Kullanıcı eklendi');
          await users();
        },
      }),
    );
    body.querySelectorAll('[data-user]').forEach((b) =>
      b.addEventListener('click', () => {
        const u = list.find((x) => x.id === b.dataset.user);
        modal({
          title: `${u.full_name} · düzenle`,
          body: `
            <label>Ad soyad<input name="full_name" required value="${esc(u.full_name)}"></label>
            <label>Rol${roleSelect(u.role)}</label>
            <label>Yeni şifre<input name="password" type="password" minlength="6" placeholder="Değiştirmeyecekseniz boş bırakın" autocomplete="new-password"></label>
            <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Aktif (pasif kullanıcı giriş yapamaz)</label>`,
          onSubmit: async (fd) => {
            const payload = { full_name: fd.get('full_name'), role: fd.get('role'), active: fd.get('active') === 'on' };
            if (fd.get('password')) payload.password = fd.get('password');
            await api(`/users/${u.id}`, { method: 'PUT', body: payload });
            toast('Kullanıcı güncellendi');
            await users();
          },
        });
      }),
    );
  }

  async function halls() {
    const list = await api('/halls');
    body.innerHTML = `
      <header class="card-head"><h3>${icon('home')} Salonlar</h3><button class="btn primary" id="add-hall">${icon('plus', 16)} Salon ekle</button></header>
      <table class="table">
        <thead><tr><th>Salon</th><th class="num">Kapasite</th><th>Durum</th></tr></thead>
        <tbody>${
          list.length
            ? list.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td class="num">${x.capacity ?? '—'}</td><td>${x.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge">Pasif</span>'}</td></tr>`).join('')
            : emptyRow(3, 'Salon yok.')
        }</tbody>
      </table>`;
    body.querySelector('#add-hall').addEventListener('click', () =>
      modal({
        title: 'Yeni salon',
        body: `<div class="grid-2"><label>Salon adı<input name="name" required></label><label>Kapasite (kişi)<input name="capacity" type="number" min="1"></label></div>`,
        onSubmit: async (fd) => {
          await api('/halls', { method: 'POST', body: { name: fd.get('name'), capacity: fd.get('capacity') ? Number(fd.get('capacity')) : null } });
          toast('Salon eklendi');
          await halls();
        },
      }),
    );
  }

  root.querySelector('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    show();
  });
  await show();
}
