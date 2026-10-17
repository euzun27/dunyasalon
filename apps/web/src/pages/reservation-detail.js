import { api } from '../services/api.js';
import {
  esc, tl, parseTL, toInput, dateTR, dateShort, dateTimeTR, today, daysUntil,
  STATUS_LABELS, EVENT_TYPES, PAYMENT_KINDS, PAY_METHODS, PRICING, SERVICE_KINDS,
} from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';
import { icon } from '../icons.js';
import { reservationForm } from './reservations.js';
import { printContract, printReceipt } from '../print.js';

const TABS = [
  ['hizmet', 'Menü & Hizmetler'],
  ['tahsilat', 'Tahsilatlar'],
  ['plan', 'Ödeme planı'],
  ['personel', 'Personel'],
  ['notlar', 'Notlar & görüşmeler'],
  ['maliyet', 'Gider & kârlılık'],
];

export async function renderReservationDetail(root, { user, params, setTitle }) {
  const id = params[0];
  const canEdit = ['admin', 'resepsiyon'].includes(user.role);
  const canMoney = ['admin', 'resepsiyon', 'muhasebe'].includes(user.role);
  const canCancelPay = ['admin', 'muhasebe'].includes(user.role);
  let tab = 'hizmet';
  let d;
  let settings = {};

  async function load() {
    [d, settings] = await Promise.all([api(`/reservations/${id}/detail`), api('/settings').catch(() => ({}))]);
    render();
  }

  function render() {
    const r = d.reservation;
    const m = d.money;
    setTitle(r.customer_name);
    const n = daysUntil(r.event_date);
    root.innerHTML = '';
    root.append(
      h(`
      <div class="page">
        <a href="#/rezervasyon" class="back">${icon('back', 16)} Rezervasyonlar</a>
        <section class="card res-head">
          <div class="res-title">
            <div class="date-chip big ${n === 0 ? 'today' : ''}"><strong>${r.event_date.slice(8, 10)}</strong><small>${new Date(r.event_date + 'T00:00:00').toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' })}</small></div>
            <div>
              <h2>${esc(r.customer_name)} <span class="badge st-${r.status}">${STATUS_LABELS[r.status]}</span></h2>
              <p class="muted">${EVENT_TYPES[r.event_type] ?? esc(r.event_type)} · ${dateTR(r.event_date)} · ${r.start_time}–${r.end_time} · ${esc(r.hall_name)}${r.guest_count ? ` · <strong>${r.guest_count}</strong> davetli` : ''}</p>
              <p class="muted small">
                ${r.customer_phone ? `<a href="tel:${esc(r.customer_phone)}">${icon('phone', 14)} ${esc(r.customer_phone)}</a> · ` : ''}
                <a href="#/musteri/${r.customer_id}">Müşteri kartı</a>
                ${r.status === 'opsiyon' && r.option_until ? ` · <span class="${r.option_until < today() ? 'neg' : 'warn-text'}">Opsiyon bitiş ${dateShort(r.option_until)}</span>` : ''}
                ${n >= 0 && r.status !== 'iptal' ? ` · ${n === 0 ? '<strong>Bugün</strong>' : `${n} gün kaldı`}` : ''}
              </p>
            </div>
          </div>
          <div class="actions">
            ${canEdit ? `<button class="btn ghost" id="edit">Düzenle</button>` : ''}
            ${canEdit && r.status === 'talep' ? '<button class="btn ghost" data-status="opsiyon">Opsiyonla</button>' : ''}
            ${canEdit && ['talep', 'opsiyon'].includes(r.status) ? '<button class="btn primary" data-status="kesin">Kesinleştir</button>' : ''}
            ${canEdit && r.status === 'kesin' && r.event_date <= today() ? '<button class="btn primary" data-status="tamamlandi">Tamamlandı</button>' : ''}
            ${canEdit && !['iptal', 'tamamlandi'].includes(r.status) ? '<button class="btn ghost danger" data-status="iptal">İptal et</button>' : ''}
            ${canEdit && r.status === 'iptal' ? '<button class="btn ghost" data-status="opsiyon">Yeniden aç</button>' : ''}
            <button class="btn ghost" id="msg">${icon('whatsapp', 16)} Mesaj</button>
            <button class="btn ghost" id="contract">${icon('print', 16)} Sözleşme</button>
          </div>
        </section>

        ${
          canMoney
            ? `<section class="money">
          ${money('Salon ücreti', tl(m.salon_kurus))}
          ${money('Menü & hizmet', tl(m.items_kurus))}
          ${m.discount_kurus ? money('İndirim', '−' + tl(m.discount_kurus)) : ''}
          ${money('Toplam', tl(m.total_kurus), 'strong')}
          ${money('Tahsil edilen', tl(m.paid_kurus), 'ok')}
          ${money('Kalan', tl(m.balance_kurus), m.balance_kurus > 0 ? 'warn' : 'ok')}
          ${m.overdue_kurus ? money('Geciken', tl(m.overdue_kurus), 'danger') : ''}
          ${r.event_account_id ? money('Kantin hesabı', `<a href="#/hesaplar">${tl(m.canteen_balance_kurus)}</a>`) : ''}
        </section>
        <div class="progress" title="Tahsilat oranı"><i style="width:${m.total_kurus ? Math.min(100, Math.round((m.paid_kurus / m.total_kurus) * 100)) : 0}%"></i></div>`
            : ''
        }

        <nav class="tabs">${TABS.filter(([k]) => canMoney || !['tahsilat', 'plan', 'maliyet'].includes(k))
          .map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}${badge(k)}</button>`)
          .join('')}</nav>
        <section class="card tab-body">${panel()}</section>
      </div>`),
    );
  }

  function badge(k) {
    const n = { hizmet: d.items.length, tahsilat: d.payments.filter((p) => !p.cancelled_at).length, plan: d.installments.length, personel: d.staff.length, notlar: d.notes.length }[k];
    return n ? ` <span class="count">${n}</span>` : '';
  }

  function panel() {
    const r = d.reservation;
    if (tab === 'hizmet') {
      return `
        <header class="card-head"><h3>Menü, paket ve hizmetler</h3>${canEdit ? `<button class="btn primary small" id="add-item">${icon('plus', 16)} Kalem ekle</button>` : ''}</header>
        <table class="table">
          <thead><tr><th>Kalem</th><th>Fiyatlandırma</th><th class="num">Miktar</th><th class="num">Birim</th><th class="num">Tutar</th><th></th></tr></thead>
          <tbody>
            <tr><td>Salon kirası</td><td>Sabit</td><td class="num">1</td><td class="num">${tl(r.price_kurus)}</td><td class="num">${tl(r.price_kurus)}</td><td></td></tr>
            ${d.items
              .map(
                (i) => `<tr><td><strong>${esc(i.name)}</strong>${i.note ? `<small class="block muted">${esc(i.note)}</small>` : ''}</td><td>${PRICING[i.pricing]}</td>
                  <td class="num">${canEdit ? `<input class="qty-input" type="number" min="1" value="${i.qty}" data-qty="${i.id}" />` : i.qty}</td>
                  <td class="num">${tl(i.unit_price_kurus)}</td><td class="num">${tl(i.total_kurus)}</td>
                  <td class="row-actions">${canEdit ? `<button class="icon-btn ghost danger" data-del-item="${i.id}" title="Kaldır">${icon('trash', 16)}</button>` : ''}</td></tr>`,
              )
              .join('')}
            ${d.money.discount_kurus ? `<tr><td colspan="4">İndirim</td><td class="num neg">−${tl(d.money.discount_kurus)}</td><td></td></tr>` : ''}
          </tbody>
          <tfoot><tr><td colspan="4"><strong>Toplam</strong></td><td class="num"><strong>${tl(d.money.total_kurus)}</strong></td><td></td></tr></tfoot>
        </table>
        ${d.items.some((i) => i.pricing === 'kisi_basi') && r.guest_count ? `<p class="muted small">Kişi başı kalemler eklendiği andaki davetli sayısıyla hesaplanır. Davetli sayısı değişirse miktarı buradan güncelleyin.</p>` : ''}`;
    }
    if (tab === 'tahsilat') {
      return `
        <header class="card-head"><h3>Tahsilatlar</h3><button class="btn primary small" id="add-pay">${icon('plus', 16)} Tahsilat al</button></header>
        <table class="table">
          <thead><tr><th>Makbuz</th><th>Tarih</th><th>Tür</th><th>Yöntem</th><th>Açıklama</th><th class="num">Tutar</th><th></th></tr></thead>
          <tbody>${
            d.payments.length
              ? d.payments
                  .map(
                    (p) => `<tr class="${p.cancelled_at ? 'muted strike' : ''}">
                <td>#${p.receipt_no}</td><td>${dateTimeTR(p.created_at)}<small class="block muted">${esc(p.user_name ?? '')}</small></td>
                <td>${PAYMENT_KINDS[p.kind]}</td><td>${PAY_METHODS[p.method]}</td>
                <td>${esc(p.note ?? '')}${p.cancelled_at ? `<small class="block neg">İptal: ${esc(p.cancel_reason ?? '')}</small>` : ''}</td>
                <td class="num ${p.kind === 'iade' ? 'neg' : ''}">${p.kind === 'iade' ? '−' : ''}${tl(p.amount_kurus)}</td>
                <td class="row-actions">
                  <button class="icon-btn ghost" data-receipt="${p.id}" title="Makbuz yazdır">${icon('print', 16)}</button>
                  ${!p.cancelled_at && canCancelPay ? `<button class="icon-btn ghost danger" data-cancel-pay="${p.id}" title="İptal et">${icon('trash', 16)}</button>` : ''}
                </td></tr>`,
                  )
                  .join('')
              : emptyRow(7, 'Henüz tahsilat yok')
          }</tbody>
        </table>`;
    }
    if (tab === 'plan') {
      let cum = 0;
      return `
        <header class="card-head"><h3>Ödeme planı</h3><div class="actions"><button class="btn ghost small" id="auto-plan">Otomatik plan</button><button class="btn primary small" id="add-inst">${icon('plus', 16)} Vade ekle</button></div></header>
        <table class="table">
          <thead><tr><th>Vade</th><th class="num">Tutar</th><th class="num">Kümülatif</th><th>Durum</th><th>Açıklama</th><th></th></tr></thead>
          <tbody>${
            d.installments.length
              ? d.installments
                  .map((i) => {
                    cum += i.amount_kurus;
                    const covered = d.money.paid_kurus >= cum;
                    const late = !covered && i.due_date < today();
                    return `<tr><td>${dateTR(i.due_date)}</td><td class="num">${tl(i.amount_kurus)}</td><td class="num">${tl(cum)}</td>
                      <td>${covered ? `<span class="badge ok">${icon('check', 12)} Karşılandı</span>` : late ? '<span class="badge danger">Gecikti</span>' : '<span class="badge">Bekliyor</span>'}</td>
                      <td>${esc(i.note ?? '')}</td><td class="row-actions"><button class="icon-btn ghost danger" data-del-inst="${i.id}">${icon('trash', 16)}</button></td></tr>`;
                  })
                  .join('')
              : emptyRow(6, 'Ödeme planı yok. "Otomatik plan" ile kalan tutarı eşit taksitlere bölebilirsiniz.')
          }</tbody>
        </table>
        ${d.installments.length && d.money.planned_kurus !== d.money.total_kurus ? `<p class="warn-text small">Plan toplamı (${tl(d.money.planned_kurus)}) sözleşme toplamından (${tl(d.money.total_kurus)}) farklı.</p>` : ''}`;
    }
    if (tab === 'personel') {
      return `
        <header class="card-head"><h3>Görevli personel</h3>${canEdit ? `<button class="btn primary small" id="add-staff">${icon('plus', 16)} Personel ata</button>` : ''}</header>
        <table class="table">
          <thead><tr><th>Personel</th><th>Görev</th><th>Telefon</th>${canMoney ? '<th class="num">Yevmiye</th>' : ''}<th></th></tr></thead>
          <tbody>${
            d.staff.length
              ? d.staff
                  .map(
                    (s) => `<tr><td><strong>${esc(s.staff_name)}</strong><small class="block muted">${esc(s.staff_title ?? '')}</small></td><td>${esc(s.task ?? '')}</td>
                    <td>${s.staff_phone ? `<a href="tel:${esc(s.staff_phone)}">${esc(s.staff_phone)}</a>` : ''}</td>${canMoney ? `<td class="num">${tl(s.wage_kurus)}</td>` : ''}
                    <td class="row-actions">${canEdit ? `<button class="icon-btn ghost danger" data-unassign="${s.id}">${icon('trash', 16)}</button>` : ''}</td></tr>`,
                  )
                  .join('')
              : emptyRow(5, 'Personel atanmadı')
          }</tbody>
          ${d.staff.length && canMoney ? `<tfoot><tr><td colspan="3"><strong>Toplam personel maliyeti</strong></td><td class="num"><strong>${tl(d.money.staff_cost_kurus)}</strong></td><td></td></tr></tfoot>` : ''}
        </table>`;
    }
    if (tab === 'notlar') {
      return `
        <header class="card-head"><h3>Notlar ve görüşmeler</h3></header>
        <form id="note-form" class="note-form"><textarea name="note" rows="2" placeholder="Görüşme notu: menü tadımı, süsleme tercihi, özel istekler…" required></textarea><button class="btn primary">Not ekle</button></form>
        <ul class="timeline">${
          d.notes.length
            ? d.notes.map((n) => `<li><small class="muted">${dateTimeTR(n.created_at)} · ${esc(n.user_name ?? '')}</small><p>${esc(n.note)}</p></li>`).join('')
            : '<li class="empty">Henüz not yok.</li>'
        }</ul>
        ${r.notes ? `<p class="muted small"><strong>Rezervasyon notu:</strong> ${esc(r.notes)}</p>` : ''}`;
    }
    if (tab === 'maliyet') {
      const m = d.money;
      return `
        <header class="card-head"><h3>Organizasyon giderleri ve kârlılık</h3><button class="btn primary small" id="add-exp">${icon('plus', 16)} Gider ekle</button></header>
        <table class="table">
          <thead><tr><th>Tarih</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead>
          <tbody>${
            d.expenses.length
              ? d.expenses.map((e) => `<tr><td>${dateShort(e.entry_date)}</td><td>${esc(e.category)}</td><td>${esc(e.description ?? '')}</td><td class="num">${tl(e.amount_kurus)}</td></tr>`).join('')
              : emptyRow(4, 'Bu organizasyona bağlı gider yok')
          }</tbody>
        </table>
        <div class="pnl">
          <div><span>Sözleşme toplamı</span><strong>${tl(m.total_kurus)}</strong></div>
          <div><span>Personel yevmiyeleri</span><strong class="neg">−${tl(m.staff_cost_kurus)}</strong></div>
          <div><span>Diğer giderler</span><strong class="neg">−${tl(m.expense_cost_kurus)}</strong></div>
          <div class="grand"><span>Organizasyon net sonucu</span><strong class="${m.net_kurus >= 0 ? 'ok-text' : 'neg'}">${tl(m.net_kurus)}</strong></div>
          ${r.event_account_id ? `<div><span>Kantin hesabı (ayrı takip)</span><strong>${tl(m.canteen_balance_kurus)}</strong></div>` : ''}
        </div>`;
    }
    return '';
  }

  async function act(fn, msg) {
    try {
      await fn();
      if (msg) toast(msg);
      await load();
    } catch (err) {
      errorToast(err);
    }
  }

  function addItemModal() {
    api('/services').then((services) => {
      const r = d.reservation;
      const groups = Object.entries(SERVICE_KINDS)
        .map(([k, v]) => {
          const list = services.filter((s) => s.kind === k);
          return list.length ? `<optgroup label="${v}">${list.map((s) => `<option value="${s.id}" data-pricing="${s.pricing}" data-price="${s.price_kurus}">${esc(s.name)} · ${tl(s.price_kurus)}${s.pricing === 'kisi_basi' ? ' / kişi' : ''}</option>`).join('')}</optgroup>` : '';
        })
        .join('');
      const m = modal({
        title: 'Kalem ekle',
        body: `
          <label>Tanımlı menü / hizmet<select name="service_id"><option value="">— Elle gir —</option>${groups}</select></label>
          <div class="grid-2">
            <label>Ad<input name="name" placeholder="Ör. Kuru pasta ikramı" /></label>
            <label>Fiyatlandırma<select name="pricing">${Object.entries(PRICING).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label>Birim fiyat (₺)<input name="price" inputmode="decimal" /></label>
            <label>Miktar<input name="qty" type="number" min="1" value="1" /></label>
          </div>
          <label>Not<input name="note" /></label>
          <p class="muted small" id="calc"></p>
          ${services.length ? '' : '<p class="muted small">İpucu: Sık kullandığınız menü ve hizmetleri "Menü & Hizmetler" sayfasında tanımlayın.</p>'}`,
        submitLabel: 'Ekle',
        onSubmit: async (f) => {
          const sid = f.get('service_id');
          await api(`/reservations/${id}/items`, {
            method: 'POST',
            body: {
              service_id: sid || null,
              name: f.get('name') || undefined,
              pricing: f.get('pricing'),
              unit_price_kurus: f.get('price') ? parseTL(f.get('price')) : undefined,
              qty: Number(f.get('qty')) || undefined,
              note: f.get('note') || null,
            },
          });
          toast('Kalem eklendi');
          await load();
        },
      });
      const f = m.form;
      const calc = () => {
        const unit = f.price.value ? parseTL(f.price.value) : 0;
        f.querySelector('#calc').textContent = unit ? `Tutar: ${tl(unit * (Number(f.qty.value) || 0))}` : '';
      };
      f.service_id.addEventListener('change', () => {
        const o = f.service_id.selectedOptions[0];
        if (!o?.value) return;
        f.name.value = o.textContent.split(' · ')[0];
        f.pricing.value = o.dataset.pricing;
        f.price.value = toInput(Number(o.dataset.price));
        f.qty.value = o.dataset.pricing === 'kisi_basi' ? r.guest_count || 1 : 1;
        calc();
      });
      f.pricing.addEventListener('change', () => {
        if (f.pricing.value === 'kisi_basi' && r.guest_count) f.qty.value = r.guest_count;
        calc();
      });
      f.price.addEventListener('input', calc);
      f.qty.addEventListener('input', calc);
    }, errorToast);
  }

  function addPaymentModal() {
    const m0 = d.money;
    const firstPay = d.payments.filter((p) => !p.cancelled_at).length === 0;
    modal({
      title: 'Tahsilat al',
      body: `
        <p class="muted">Kalan bakiye: <strong>${tl(m0.balance_kurus)}</strong></p>
        <div class="grid-2">
          <label>Tür<select name="kind">${Object.entries(PAYMENT_KINDS).map(([k, v]) => `<option value="${k}" ${k === (firstPay ? 'kapora' : 'ara_odeme') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Yöntem<select name="method">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        <label>Tutar (₺)<input name="amount" required inputmode="decimal" value="${firstPay && d.reservation.deposit_kurus ? toInput(d.reservation.deposit_kurus) : ''}" /></label>
        <label>Açıklama<input name="note" /></label>
        <label class="check"><input type="checkbox" name="print" checked /> Makbuz yazdır</label>`,
      submitLabel: 'Tahsil et',
      onSubmit: async (f) => {
        const p = await api(`/reservations/${id}/payments`, {
          method: 'POST',
          body: { kind: f.get('kind'), method: f.get('method'), amount_kurus: parseTL(f.get('amount')), note: f.get('note') || null },
        });
        toast(`Makbuz #${p.receipt_no} oluşturuldu`);
        await load();
        if (f.get('print') === 'on') printReceipt({ ...p, user_name: user.full_name }, d.reservation, settings, d.money);
      },
    });
  }

  function autoPlanModal() {
    const remaining = d.money.balance_kurus;
    modal({
      title: 'Otomatik ödeme planı',
      body: `
        <p class="muted">Kalan <strong>${tl(remaining)}</strong> eşit taksitlere bölünür; son taksit etkinlikten belirtilen gün önceye denk gelir.</p>
        <div class="grid-2">
          <label>Taksit sayısı<input name="n" type="number" min="1" max="24" value="3" /></label>
          <label>İlk vade<input name="first" type="date" value="${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}" /></label>
          <label>Aralık (ay)<input name="every" type="number" min="1" max="6" value="1" /></label>
        </div>`,
      submitLabel: 'Planı oluştur',
      onSubmit: async (f) => {
        if (remaining <= 0) throw new Error('Kalan bakiye yok');
        const n = Number(f.get('n'));
        const every = Number(f.get('every'));
        const base = Math.floor(remaining / n / 100) * 100;
        for (let i = 0; i < n; i++) {
          const due = new Date(f.get('first') + 'T00:00:00');
          due.setMonth(due.getMonth() + i * every);
          const amount = i === n - 1 ? remaining - base * (n - 1) : base;
          await api(`/reservations/${id}/installments`, {
            method: 'POST',
            body: { due_date: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`, amount_kurus: amount, note: `${i + 1}. taksit` },
          });
        }
        toast('Ödeme planı oluşturuldu');
        await load();
      },
    });
  }

  async function messageModal() {
    const templates = await api('/message-templates').catch(errorToast);
    if (!templates) return;
    const m = modal({
      title: 'Müşteriye mesaj',
      body: `
        <label>Şablon<select name="tpl">${templates.map((t) => `<option value="${t.key}">${esc(t.title)}</option>`).join('')}</select></label>
        <label>Mesaj<textarea name="body" rows="6"></textarea></label>
        <p class="muted small">WhatsApp, bu bilgisayarda (veya telefonda) açık WhatsApp ile gönderir. SMS, bağlı telefonun mesaj uygulamasını açar.</p>
        <div class="actions"><a class="btn primary" id="wa" target="_blank" rel="noopener">${icon('whatsapp', 16)} WhatsApp ile gönder</a><a class="btn ghost" id="sms">SMS</a><button type="button" class="btn ghost" id="copy">Kopyala</button></div>`,
    });
    const f = m.form;
    const phone = d.reservation.customer_phone;
    const refresh = async () => {
      const lastPay = d.payments.filter((p) => !p.cancelled_at).at(-1);
      const res = await api(`/reservations/${id}/message`, { query: { template: f.tpl.value, tutar: lastPay ? tl(lastPay.amount_kurus) : '', makbuz: lastPay?.receipt_no ?? '' } });
      f.body.value = res.text;
      update();
    };
    const update = () => {
      const wa = f.querySelector('#wa');
      const sms = f.querySelector('#sms');
      const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '90').replace(/^5/, '905');
      wa.href = phone ? `https://wa.me/${digits}?text=${encodeURIComponent(f.body.value)}` : '#';
      sms.href = phone ? `sms:${phone}?body=${encodeURIComponent(f.body.value)}` : '#';
      wa.classList.toggle('disabled', !phone);
    };
    f.tpl.addEventListener('change', refresh);
    f.body.addEventListener('input', update);
    f.addEventListener('click', async (e) => {
      const a = e.target.closest('#wa, #sms');
      if (a) {
        if (!phone) return (e.preventDefault(), toast('Müşterinin telefonu kayıtlı değil', 'error'));
        api(`/reservations/${id}/message-log`, { method: 'POST', body: { channel: a.id === 'wa' ? 'whatsapp' : 'sms', body: f.body.value } }).catch(() => {});
      }
      if (e.target.closest('#copy')) {
        await navigator.clipboard?.writeText(f.body.value).catch(() => {});
        toast('Mesaj kopyalandı');
      }
    });
    refresh().catch(errorToast);
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      return render();
    }
    if (b.id === 'edit') {
      const halls = await api('/halls');
      return reservationForm(d.reservation, halls, () => load());
    }
    if (b.dataset.status) {
      const labels = { kesin: 'kesinleştirilsin', iptal: 'iptal edilsin', tamamlandi: 'tamamlandı olarak kapatılsın', opsiyon: 'opsiyon durumuna alınsın' };
      if (!window.confirm(`Rezervasyon ${labels[b.dataset.status]} mi?`)) return;
      return act(() => api(`/reservations/${id}/status`, { method: 'POST', body: { status: b.dataset.status } }), 'Durum güncellendi');
    }
    if (b.id === 'contract') return printContract(d, settings);
    if (b.id === 'msg') return messageModal();
    if (b.id === 'add-item') return addItemModal();
    if (b.dataset.delItem) return act(() => api(`/reservation-items/${b.dataset.delItem}`, { method: 'DELETE' }), 'Kalem kaldırıldı');
    if (b.id === 'add-pay') return addPaymentModal();
    if (b.dataset.receipt) {
      const p = d.payments.find((x) => x.id === b.dataset.receipt);
      return printReceipt(p, d.reservation, settings, d.money);
    }
    if (b.dataset.cancelPay) {
      return modal({
        title: 'Tahsilatı iptal et',
        body: '<p class="muted">Kayıt silinmez, gerekçesiyle iptal olarak işaretlenir.</p><label>Gerekçe<input name="reason" required /></label>',
        submitLabel: 'İptal et',
        onSubmit: async (f) => act(() => api(`/reservation-payments/${b.dataset.cancelPay}/cancel`, { method: 'POST', body: { reason: f.get('reason') } }), 'Tahsilat iptal edildi'),
      });
    }
    if (b.id === 'add-inst') {
      return modal({
        title: 'Vade ekle',
        body: '<div class="grid-2"><label>Vade tarihi<input type="date" name="due" required /></label><label>Tutar (₺)<input name="amount" required inputmode="decimal" /></label></div><label>Açıklama<input name="note" /></label>',
        onSubmit: async (f) => act(() => api(`/reservations/${id}/installments`, { method: 'POST', body: { due_date: f.get('due'), amount_kurus: parseTL(f.get('amount')), note: f.get('note') || null } }), 'Vade eklendi'),
      });
    }
    if (b.id === 'auto-plan') return autoPlanModal();
    if (b.dataset.delInst) return act(() => api(`/reservation-installments/${b.dataset.delInst}`, { method: 'DELETE' }), 'Vade silindi');
    if (b.id === 'add-staff') {
      const staff = await api('/staff');
      if (!staff.length) return toast('Önce "Personel" sayfasından personel ekleyin.', 'error');
      return modal({
        title: 'Personel ata',
        body: `<label>Personel<select name="staff_id">${staff.map((s) => `<option value="${s.id}" data-wage="${s.daily_wage_kurus}">${esc(s.full_name)}${s.title ? ' · ' + esc(s.title) : ''}</option>`).join('')}</select></label>
               <div class="grid-2"><label>Görev<input name="task" placeholder="Servis, mutfak, DJ…" /></label><label>Yevmiye (₺)<input name="wage" inputmode="decimal" placeholder="Varsayılan yevmiye" /></label></div>`,
        submitLabel: 'Ata',
        onSubmit: async (f) =>
          act(() => api(`/reservations/${id}/staff`, { method: 'POST', body: { staff_id: f.get('staff_id'), task: f.get('task') || null, wage_kurus: f.get('wage') ? parseTL(f.get('wage')) : undefined } }), 'Personel atandı'),
      });
    }
    if (b.dataset.unassign) return act(() => api(`/event-staff/${b.dataset.unassign}`, { method: 'DELETE' }), 'Atama kaldırıldı');
    if (b.id === 'add-exp') {
      const cats = await api('/finance/categories');
      return modal({
        title: 'Organizasyon gideri',
        body: `<div class="grid-2"><label>Kategori<select name="category">${cats.gider.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
               <label>Tutar (₺)<input name="amount" required inputmode="decimal" /></label>
               <label>Tarih<input type="date" name="date" value="${d.reservation.event_date}" /></label>
               <label>Yöntem<select name="method">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
               <label>Açıklama<input name="desc" /></label>`,
        onSubmit: async (f) =>
          act(
            () => api('/finance/entries', { method: 'POST', body: { type: 'gider', category: f.get('category'), amount_kurus: parseTL(f.get('amount')), entry_date: f.get('date'), method: f.get('method'), description: f.get('desc') || null, reservation_id: id } }),
            'Gider eklendi',
          ),
      });
    }
  });

  root.addEventListener('change', (e) => {
    const q = e.target.closest('[data-qty]');
    if (q) act(() => api(`/reservation-items/${q.dataset.qty}`, { method: 'PUT', body: { qty: Number(q.value) } }), 'Miktar güncellendi');
  });

  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'note-form') return;
    e.preventDefault();
    const note = new FormData(e.target).get('note');
    act(() => api('/customer-notes', { method: 'POST', body: { customer_id: d.reservation.customer_id, reservation_id: id, note } }), 'Not eklendi');
  });

  await load().catch(errorToast);
}

function money(label, value, tone = '') {
  return `<div class="money-cell ${tone}"><small>${label}</small><span>${value}</span></div>`;
}
