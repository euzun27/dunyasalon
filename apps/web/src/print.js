import { esc, tl, dateShort, EVENT_TYPES, PAYMENT_KINDS, PAY_METHODS, PRICING } from './services/format.js';

const BASE_CSS = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 11.5pt/1.5 'Segoe UI', Roboto, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 4px; letter-spacing: .02em; }
  h2 { font-size: 12pt; margin: 18px 0 6px; border-bottom: 1.5px solid #7a1f3d; padding-bottom: 3px; color: #7a1f3d; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #7a1f3d; padding-bottom: 10px; margin-bottom: 12px; }
  .head small { display: block; color: #555; }
  .meta { text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 5px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #f6eef1; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .03em; }
  .num { text-align: right; white-space: nowrap; }
  .kv td:first-child { width: 34%; color: #555; }
  .total td { font-weight: 700; border-top: 2px solid #111; }
  .terms { white-space: pre-wrap; font-size: 10pt; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
  .sign div { border-top: 1px solid #111; padding-top: 6px; }
  .big { font-size: 20pt; font-weight: 700; }
  .receipt { max-width: 150mm; margin: 0 auto; border: 1.5px solid #111; padding: 14px 18px; }
  .note { font-size: 9pt; color: #666; margin-top: 14px; }
`;

function printHtml(title, body) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 150);
}

function header(s, title, right) {
  return `<div class="head">
    <div><h1>${esc(s['business.name'] || 'DÜĞÜN SALONU')}</h1>
      <small>${esc(s['business.address'] || '')}</small>
      <small>${esc(s['business.phone'] || '')}${s['business.tax'] ? ' · ' + esc(s['business.tax']) : ''}</small></div>
    <div class="meta"><strong>${esc(title)}</strong>${right}</div>
  </div>`;
}

export function printContract(d, s) {
  const r = d.reservation;
  const c = d.customer ?? {};
  const m = d.money;
  const body = `
    ${header(s, 'ORGANİZASYON SÖZLEŞMESİ', `<small>Sözleşme tarihi: ${dateShort(new Date().toISOString())}</small><small>No: ${esc(r.id.slice(0, 8).toUpperCase())}</small>`)}
    <h2>Taraflar</h2>
    <table class="kv">
      <tr><td>Kiralayan (müşteri)</td><td><strong>${esc(r.customer_name)}</strong></td></tr>
      <tr><td>T.C. kimlik no</td><td>${esc(c.national_id ?? '')}</td></tr>
      <tr><td>Telefon</td><td>${esc(r.customer_phone ?? '')}</td></tr>
      <tr><td>Adres</td><td>${esc(c.address ?? '')}</td></tr>
    </table>
    <h2>Organizasyon bilgileri</h2>
    <table class="kv">
      <tr><td>Organizasyon türü</td><td>${EVENT_TYPES[r.event_type] ?? esc(r.event_type)}</td></tr>
      <tr><td>Tarih ve saat</td><td><strong>${dateShort(r.event_date)}</strong> · ${r.start_time} – ${r.end_time}</td></tr>
      <tr><td>Salon</td><td>${esc(r.hall_name)}</td></tr>
      <tr><td>Davetli sayısı</td><td>${r.guest_count ?? ''}</td></tr>
    </table>
    <h2>Ücret ve hizmetler</h2>
    <table>
      <thead><tr><th>Kalem</th><th class="num">Miktar</th><th class="num">Birim</th><th class="num">Tutar</th></tr></thead>
      <tbody>
        <tr><td>Salon kirası</td><td class="num">1</td><td class="num">${tl(r.price_kurus)}</td><td class="num">${tl(r.price_kurus)}</td></tr>
        ${d.items.map((i) => `<tr><td>${esc(i.name)}${i.pricing === 'kisi_basi' ? ' <small>(kişi başı)</small>' : ''}</td><td class="num">${i.qty}</td><td class="num">${tl(i.unit_price_kurus)}</td><td class="num">${tl(i.total_kurus)}</td></tr>`).join('')}
        ${m.discount_kurus ? `<tr><td colspan="3">İndirim</td><td class="num">−${tl(m.discount_kurus)}</td></tr>` : ''}
        <tr class="total"><td colspan="3">GENEL TOPLAM (KDV dahil)</td><td class="num">${tl(m.total_kurus)}</td></tr>
        <tr><td colspan="3">Alınan ödemeler</td><td class="num">${tl(m.paid_kurus)}</td></tr>
        <tr class="total"><td colspan="3">KALAN</td><td class="num">${tl(m.balance_kurus)}</td></tr>
      </tbody>
    </table>
    ${
      d.installments.length
        ? `<h2>Ödeme planı</h2><table><thead><tr><th>Vade</th><th class="num">Tutar</th><th>Açıklama</th></tr></thead><tbody>${d.installments
            .map((i) => `<tr><td>${dateShort(i.due_date)}</td><td class="num">${tl(i.amount_kurus)}</td><td>${esc(i.note ?? '')}</td></tr>`)
            .join('')}</tbody></table>`
        : ''
    }
    ${r.notes ? `<h2>Özel notlar</h2><p>${esc(r.notes)}</p>` : ''}
    <h2>Genel şartlar</h2>
    <div class="terms">${esc(s['contract.terms'] || '')}</div>
    <div class="sign"><div>Kiralayan<br>${esc(r.customer_name)}</div><div>İşletme<br>${esc(s['business.name'] || '')}</div></div>`;
  printHtml(`Sözleşme - ${r.customer_name}`, body);
}

export function printReceipt(p, r, s, money) {
  const body = `
    <div class="receipt">
      ${header(s, p.kind === 'iade' ? 'İADE MAKBUZU' : 'TAHSİLAT MAKBUZU', `<small>Makbuz no: <strong>${p.receipt_no}</strong></small><small>${dateShort(p.created_at)} ${new Date(p.created_at).toLocaleTimeString('tr-TR', { timeStyle: 'short' })}</small>`)}
      <table class="kv">
        <tr><td>Müşteri</td><td><strong>${esc(r.customer_name)}</strong></td></tr>
        <tr><td>Organizasyon</td><td>${EVENT_TYPES[r.event_type] ?? ''} · ${dateShort(r.event_date)} · ${esc(r.hall_name)}</td></tr>
        <tr><td>Ödeme türü</td><td>${PAYMENT_KINDS[p.kind]} · ${PAY_METHODS[p.method]}</td></tr>
        ${p.note ? `<tr><td>Açıklama</td><td>${esc(p.note)}</td></tr>` : ''}
        <tr><td>Tutar</td><td class="big">${tl(p.amount_kurus)}</td></tr>
        ${money ? `<tr><td>Toplam / ödenen / kalan</td><td>${tl(money.total_kurus)} / ${tl(money.paid_kurus)} / <strong>${tl(money.balance_kurus)}</strong></td></tr>` : ''}
        ${p.cancelled_at ? `<tr><td>DURUM</td><td><strong>İPTAL EDİLDİ</strong> (${esc(p.cancel_reason ?? '')})</td></tr>` : ''}
      </table>
      <div class="sign"><div>Teslim eden</div><div>Teslim alan<br>${esc(p.user_name ?? '')}</div></div>
      <p class="note">Bu belge tahsilat makbuzudur, mali belge (fatura / e-Arşiv) yerine geçmez.</p>
    </div>`;
  printHtml(`Makbuz ${p.receipt_no}`, body);
}

export { PRICING };
