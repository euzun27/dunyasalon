import { api } from '../services/api.js';
import { esc, tl, parseTL, dateTR, dateTimeTR } from '../services/format.js';
import { h, modal, toast, errorToast, emptyRow } from '../ui.js';

export async function renderAccounts(root, { user }) {
  const canPost = ['admin', 'muhasebe', 'resepsiyon'].includes(user.role);
  const canClose = ['admin', 'muhasebe'].includes(user.role);
  root.append(
    h(`
    <div class="page">
      <header class="page-head">
        
        <div class="actions">
          <select id="filter"><option value="acik">Açık hesaplar</option><option value="kapali">Kapalı hesaplar</option><option value="">Tümü</option></select>
          ${canPost ? '<button class="btn primary" id="new">+ Hesap aç</button>' : ''}
        </div>
      </header>
      <div class="split accounts-split">
        <div class="card"><table class="table">
          <thead><tr><th>Hesap</th><th>Tarih</th><th class="num">Borç</th><th class="num">Tahsilat</th><th class="num">Bakiye</th></tr></thead>
          <tbody id="rows"></tbody>
        </table></div>
        <div class="card" id="detail"><p class="empty">Ayrıntı için bir hesap seçin.</p></div>
      </div>
    </div>`),
  );
  const $ = (s) => root.querySelector(s);
  let selected = null;

  async function load() {
    const list = await api('/event-accounts', { query: { status: $('#filter').value } });
    $('#rows').innerHTML = list.length
      ? list
          .map(
            (a) => `<tr class="clickable ${a.id === selected ? 'selected' : ''}" data-id="${a.id}">
              <td>${esc(a.title)}${a.status === 'kapali' ? ' <span class="badge">kapalı</span>' : ''}</td>
              <td>${a.event_date ? dateTR(a.event_date) : ''}</td>
              <td class="num">${tl(a.debit_kurus)}</td><td class="num">${tl(a.credit_kurus)}</td>
              <td class="num"><strong>${tl(a.balance_kurus)}</strong></td></tr>`,
          )
          .join('')
      : emptyRow(5, 'Hesap yok');
    if (selected) await showDetail(selected);
  }

  async function showDetail(id) {
    selected = id;
    root.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
    const a = await api(`/event-accounts/${id}`);
    $('#detail').innerHTML = `
      <header class="detail-head">
        <div><h2>${esc(a.title)}</h2><small class="muted">${a.status === 'acik' ? 'Açık' : 'Kapalı'}${a.credit_limit_kurus != null ? ` · Limit ${tl(a.credit_limit_kurus)}` : ''}</small></div>
        <div class="balance ${a.balance_kurus > 0 ? 'neg' : ''}">${tl(a.balance_kurus)}<small>bakiye</small></div>
      </header>
      <div class="actions">
        ${canPost && a.status === 'acik' ? '<button class="btn primary small" data-entry="alacak">Tahsilat al</button><button class="btn ghost small" data-entry="borc">Borç ekle</button>' : ''}
        ${canClose ? `<button class="btn ghost small" data-status="${a.status === 'acik' ? 'kapali' : 'acik'}">${a.status === 'acik' ? 'Hesabı kapat' : 'Yeniden aç'}</button>` : ''}
        <button class="btn ghost small" id="print">Yazdır</button>
      </div>
      <table class="table compact">
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
        }</tbody>
      </table>`;
  }

  root.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row) return showDetail(row.dataset.id).catch(errorToast);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'new') {
      modal({
        title: 'Organizasyon hesabı aç',
        body: `<label>Hesap adı<input name="title" required placeholder="Ör. Ayşe & Mehmet · 12 Haziran" /></label>
               <label>Kredi limiti (₺, boş = limitsiz)<input name="limit" inputmode="decimal" /></label>
               <p class="muted small">Kesinleşen rezervasyonlar için hesap otomatik açılır.</p>`,
        onSubmit: async (f) => {
          const a = await api('/event-accounts', {
            method: 'POST',
            body: { title: f.get('title'), credit_limit_kurus: f.get('limit') ? parseTL(f.get('limit')) : null },
          });
          selected = a.id;
          await load();
        },
      });
    }
    if (b.dataset.entry) {
      const isPayment = b.dataset.entry === 'alacak';
      modal({
        title: isPayment ? 'Tahsilat al' : 'Borç ekle',
        body: `<label>Tutar (₺)<input name="amount" required inputmode="decimal" /></label>
               <label>Açıklama<input name="desc" required value="${isPayment ? 'Nakit tahsilat' : ''}" placeholder="${isPayment ? '' : 'Ör. Ek pasta servisi'}" /></label>`,
        onSubmit: async (f) => {
          await api(`/event-accounts/${selected}/entries`, {
            method: 'POST',
            body: { entry_type: b.dataset.entry, amount_kurus: parseTL(f.get('amount')), description: f.get('desc') },
          });
          toast('Kaydedildi');
          await load();
        },
      });
    }
    if (b.dataset.status) {
      await api(`/event-accounts/${selected}/status`, { method: 'POST', body: { status: b.dataset.status } }).catch(errorToast);
      await load();
    }
    if (b.id === 'print') window.print();
  });
  $('#filter').addEventListener('change', () => load().catch(errorToast));
  await load().catch(errorToast);
}
