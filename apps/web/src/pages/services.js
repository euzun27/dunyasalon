import { api } from '../services/api.js';
import { esc, tl, parseTL, toInput, SERVICE_KINDS, PRICING } from '../services/format.js';
import { h, modal, toast, errorToast } from '../ui.js';
import { icon } from '../icons.js';

const KIND_HINTS = {
  paket: 'Salon + menü + hizmetleri tek fiyatta toplayan hazır paketler',
  menu: 'Yemek, ikram ve pasta menüleri (genelde kişi başı)',
  hizmet: 'Süsleme, orkestra, fotoğraf, gelin arabası gibi ek hizmetler',
};

export async function renderServices(root, { user }) {
  const canEdit = ['admin', 'muhasebe'].includes(user.role);
  let list = [];
  let showInactive = false;

  root.append(
    h(`
    <div class="page">
      <div class="page-head">
        <label class="check"><input type="checkbox" id="inactive"> Pasifleri de göster</label>
        ${canEdit ? `<button class="btn primary" id="add">${icon('plus', 16)} Yeni kalem</button>` : ''}
      </div>
      <div id="groups" class="page-flow"></div>
      <p class="muted small">Buradaki kalemler rezervasyon ayrıntısındaki "Menü & Hizmetler" sekmesinden etkinliğe eklenir. Kişi başı fiyatlı kalemlerde adet, davetli sayısından otomatik gelir.</p>
    </div>`),
  );
  const groups = root.querySelector('#groups');

  async function load() {
    try {
      list = await api('/services', { query: { all: showInactive ? 1 : undefined } });
      groups.innerHTML = Object.entries(SERVICE_KINDS)
        .map(([kind, label]) => {
          const items = list.filter((s) => s.kind === kind);
          return `
          <section class="card">
            <header class="card-head"><h3>${icon(kind === 'menu' ? 'menu' : kind === 'paket' ? 'ring' : 'check')} ${label}</h3><span class="muted small">${KIND_HINTS[kind]}</span></header>
            ${
              items.length
                ? `<div class="tile-grid">${items
                    .map(
                      (s) => `
                <button class="tile ${s.active ? '' : 'inactive'}" data-id="${s.id}" ${canEdit ? '' : 'disabled'}>
                  <strong>${esc(s.name)}</strong>
                  ${s.description ? `<small class="muted">${esc(s.description)}</small>` : ''}
                  <span class="tile-foot"><span class="price">${tl(s.price_kurus)}</span><span class="badge">${PRICING[s.pricing]}</span>${s.active ? '' : '<span class="badge danger">Pasif</span>'}</span>
                </button>`,
                    )
                    .join('')}</div>`
                : `<p class="empty">Henüz ${label.toLocaleLowerCase('tr')} tanımlı değil.</p>`
            }
          </section>`;
        })
        .join('');
    } catch (e) {
      errorToast(e);
    }
  }

  function edit(s) {
    modal({
      title: s ? 'Kalemi düzenle' : 'Yeni menü / hizmet',
      body: `
        <label>Ad<input name="name" required maxlength="120" value="${esc(s?.name ?? '')}" placeholder="ör. Akşam yemeği menüsü"></label>
        <div class="grid-2">
          <label>Tür<select name="kind">${Object.entries(SERVICE_KINDS).map(([k, v]) => `<option value="${k}" ${s?.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Fiyatlandırma<select name="pricing">${Object.entries(PRICING).map(([k, v]) => `<option value="${k}" ${s?.pricing === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Fiyat (₺)<input name="price" inputmode="decimal" required value="${toInput(s?.price_kurus)}" placeholder="0"></label>
          ${s ? `<label class="check" style="align-self:end"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Aktif</label>` : '<span></span>'}
        </div>
        <label>Açıklama / içerik<textarea name="description" rows="3" placeholder="Menü içeriği, hizmet ayrıntısı…">${esc(s?.description ?? '')}</textarea></label>`,
      onSubmit: async (fd) => {
        const body = {
          name: fd.get('name'),
          kind: fd.get('kind'),
          pricing: fd.get('pricing'),
          price_kurus: parseTL(fd.get('price')),
          description: fd.get('description'),
          active: s ? fd.get('active') === 'on' : true,
        };
        await api(s ? `/services/${s.id}` : '/services', { method: s ? 'PUT' : 'POST', body });
        toast('Kaydedildi');
        await load();
      },
    });
  }

  root.querySelector('#inactive').addEventListener('change', (e) => {
    showInactive = e.target.checked;
    load();
  });
  root.querySelector('#add')?.addEventListener('click', () => edit(null));
  groups.addEventListener('click', (e) => {
    const t = e.target.closest('[data-id]');
    if (t && canEdit) edit(list.find((s) => s.id === t.dataset.id));
  });
  await load();
}
