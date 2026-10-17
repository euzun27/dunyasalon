import { api } from '../services/api.js';
import { esc, tl, parseTL, dateShort, today, PAY_METHODS } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export async function renderFinance(root) {
  let { from, to } = monthRange(today().slice(0, 7));
  const cats = await api('/finance/categories').catch(() => ({ gider: ['Diğer'], gelir: ['Diğer'] }));

  root.append(
    h(`
    <div class="page">
      <div class="page-head">
        <div class="actions">
          <input type="month" id="month" value="${from.slice(0, 7)}" aria-label="Ay">
          <span class="muted small">veya</span>
          <input type="date" id="from" value="${from}" aria-label="Başlangıç">
          <span class="muted">–</span>
          <input type="date" id="to" value="${to}" aria-label="Bitiş">
        </div>
        <div class="actions">
          <button class="btn ghost" data-add="gelir">${icon('plus', 16)} Gelir ekle</button>
          <button class="btn primary" data-add="gider">${icon('plus', 16)} Gider ekle</button>
        </div>
      </div>
      <section class="kpis" id="sum"></section>
      <div class="grid-main">
        <section class="card">
          <header class="card-head"><h3>${icon('receipt')} Gelir & gider kayıtları</h3></header>
          <table class="table">
            <thead><tr><th>Tarih</th><th>Kategori</th><th>Açıklama</th><th>Yöntem</th><th class="num">Tutar</th><th></th></tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </section>
        <div class="stack" id="side"></div>
      </div>
      <p class="muted small">Rezervasyon tahsilatları ve kantin satışları otomatik gelir sayılır; etkinliklere atanan personel yevmiyeleri otomatik gider sayılır. Buraya yalnızca bunların dışındaki kalemleri (kira, fatura, mutfak alımı…) girin.</p>
    </div>`),
  );

  const sum = root.querySelector('#sum');
  const rows = root.querySelector('#rows');
  const side = root.querySelector('#side');

  async function load() {
    try {
      const [s, list] = await Promise.all([api('/finance/summary', { query: { from, to } }), api('/finance/entries', { query: { from, to } })]);
      sum.innerHTML = `
        ${kpi('wallet', 'Toplam gelir', tl(s.income_kurus), 'ok')}
        ${kpi('receipt', 'Toplam gider', tl(s.expense_kurus), 'danger')}
        ${kpi('chart', 'Net', tl(s.net_kurus), s.net_kurus >= 0 ? 'ok' : 'danger')}
        ${kpi('ring', 'Rezervasyon tahsilatı', tl(s.reservation_income_kurus))}
        ${kpi('cart', 'Kantin satışı', tl(s.pos_income_kurus))}`;
      rows.innerHTML = list.length
        ? list
            .map(
              (e) => `
          <tr>
            <td>${dateShort(e.entry_date)}</td>
            <td><span class="badge ${e.type === 'gelir' ? 'ok' : 'danger'}">${e.type === 'gelir' ? 'Gelir' : 'Gider'}</span> ${esc(e.category)}</td>
            <td>${esc(e.description ?? '')}${e.customer_name ? `<small class="block muted"><a href="#/rezervasyon/${e.reservation_id}">${esc(e.customer_name)}</a></small>` : ''}</td>
            <td>${PAY_METHODS[e.method] ?? esc(e.method)}</td>
            <td class="num ${e.type === 'gider' ? 'neg' : 'ok-text'}">${e.type === 'gider' ? '−' : '+'}${tl(e.amount_kurus)}</td>
            <td class="row-actions"><button class="icon-btn ghost danger" data-del="${e.id}" title="Sil">${icon('trash', 16)}</button></td>
          </tr>`,
            )
            .join('')
        : emptyRow(6, 'Bu dönemde elle girilmiş kayıt yok.');

      const methods = (o) =>
        Object.entries(o)
          .map(([k, v]) => `<tr><td>${PAY_METHODS[k] ?? (k === 'dugun_hesabi' ? 'Düğün hesabı' : esc(k))}</td><td class="num">${tl(v)}</td></tr>`)
          .join('') || '<tr><td class="muted">Kayıt yok</td><td></td></tr>';
      const expenseCats = s.by_category.filter((c) => c.type === 'gider');
      const maxExp = Math.max(1, s.staff_wages_kurus, ...expenseCats.map((c) => c.total));
      side.innerHTML = `
        <section class="card">
          <header class="card-head"><h3>Gelir dağılımı</h3></header>
          <table class="table compact"><tbody>
            <tr><td colspan="2" class="muted small">Rezervasyon tahsilatı</td></tr>${methods(s.reservation_by_method)}
            ${Object.keys(s.pos_by_method).length ? `<tr><td colspan="2" class="muted small">Kantin</td></tr>${methods(s.pos_by_method)}` : ''}
            <tr><td>Diğer gelirler</td><td class="num">${tl(s.other_income_kurus)}</td></tr>
          </tbody></table>
        </section>
        <section class="card">
          <header class="card-head"><h3>Gider dağılımı</h3></header>
          <div class="bars">
            ${s.staff_wages_kurus ? bar('Personel yevmiyeleri', s.staff_wages_kurus, maxExp) : ''}
            ${expenseCats.map((c) => bar(c.category, c.total, maxExp)).join('')}
            ${!s.staff_wages_kurus && !expenseCats.length ? '<p class="empty">Gider yok.</p>' : ''}
          </div>
        </section>`;
    } catch (e) {
      errorToast(e);
    }
  }

  root.querySelector('#month').addEventListener('change', (e) => {
    if (!e.target.value) return;
    ({ from, to } = monthRange(e.target.value));
    root.querySelector('#from').value = from;
    root.querySelector('#to').value = to;
    load();
  });
  for (const sel of ['#from', '#to']) {
    root.querySelector(sel).addEventListener('change', () => {
      const f = root.querySelector('#from').value;
      const t = root.querySelector('#to').value;
      if (!f || !t || f > t) return;
      from = f;
      to = t;
      root.querySelector('#month').value = '';
      load();
    });
  }

  root.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addEntry(add.dataset.add);
    const del = e.target.closest('[data-del]');
    if (del) {
      modal({
        title: 'Kaydı sil',
        body: '<p>Bu gelir/gider kaydı silinsin mi? Silinen kayıt raporlardan çıkarılır.</p>',
        submitLabel: 'Sil',
        onSubmit: async () => {
          await api(`/finance/entries/${del.dataset.del}`, { method: 'DELETE' });
          toast('Kayıt silindi');
          await load();
        },
      });
    }
  });

  function addEntry(type) {
    const list = cats[type] ?? [];
    modal({
      title: type === 'gelir' ? 'Gelir ekle' : 'Gider ekle',
      body: `
        <div class="grid-2">
          <label>Kategori<select name="category">${list.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label>Tutar (₺)<input name="amount" inputmode="decimal" required placeholder="0,00"></label>
          <label>Tarih<input name="entry_date" type="date" value="${today()}" required></label>
          <label>Yöntem<select name="method">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        <label>Açıklama<input name="description" maxlength="300" placeholder="ör. Ekim elektrik faturası"></label>`,
      onSubmit: async (fd) => {
        const amount_kurus = parseTL(fd.get('amount'));
        if (amount_kurus <= 0) throw new Error('Tutar sıfırdan büyük olmalı');
        await api('/finance/entries', {
          method: 'POST',
          body: { type, category: fd.get('category'), amount_kurus, entry_date: fd.get('entry_date'), method: fd.get('method'), description: fd.get('description') },
        });
        toast(type === 'gelir' ? 'Gelir eklendi' : 'Gider eklendi');
        await load();
      },
    });
  }

  await load();
}

function kpi(ic, label, value, tone = '') {
  return `<div class="kpi card ${tone}"><span class="kpi-ico">${icon(ic, 20)}</span><div><small>${esc(label)}</small><strong>${value}</strong></div></div>`;
}

function bar(label, v, max) {
  return `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i style="width:${Math.max(2, Math.round((v / max) * 100))}%"></i></div><strong>${tl(v)}</strong></div>`;
}
