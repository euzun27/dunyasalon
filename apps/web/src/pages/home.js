import { api } from '../services/api.js';
import { esc, tl, dateTR, dateShort, daysUntil, dateTimeTR, STATUS_LABELS, EVENT_TYPES, PAYMENT_KINDS } from '../services/format.js';
import { h, errorToast } from '../ui.js';
import { icon } from '../icons.js';

export async function renderHome(root, { user }) {
  const d = await api('/dashboard').catch((e) => (errorToast(e), null));
  if (!d) return;
  const k = d.kpis;
  const canMoney = ['admin', 'muhasebe', 'resepsiyon'].includes(user.role);
  const hello = new Date().getHours() < 12 ? 'Günaydın' : new Date().getHours() < 18 ? 'İyi günler' : 'İyi akşamlar';

  root.append(
    h(`
    <div class="page">
      <section class="hero card">
        <div>
          <h2>${hello}, ${esc(user.full_name.split(' ')[0])}</h2>
          <p class="muted">${d.todays.length ? `Bugün <strong>${d.todays.length}</strong> organizasyon var.` : 'Bugün planlanmış organizasyon yok.'}
            Önümüzdeki 30 günde <strong>${k.upcoming_30_days}</strong> etkinlik.${k.pending_requests ? ` <a href="#/rezervasyon">${k.pending_requests} yeni talep</a> bekliyor.` : ''}</p>
        </div>
        <div class="hero-actions">
          ${['admin', 'resepsiyon'].includes(user.role) ? `<a class="btn primary" href="#/rezervasyon?yeni=1">${icon('plus')} Yeni rezervasyon</a>` : ''}
          ${['admin', 'kasiyer'].includes(user.role) ? `<a class="btn ghost" href="#/kasa">${icon('cart')} Kantin kasası</a>` : ''}
        </div>
      </section>

      ${
        canMoney
          ? `<section class="kpis">
        ${kpi('calendar', 'Bu ay etkinlik', k.month_events, 'kesinleşmiş')}
        ${kpi('doc', 'Bu ay sözleşme', tl(k.month_contract_kurus), 'etkinlik tarihine göre')}
        ${kpi('wallet', 'Bu ay tahsilat', tl(k.month_collected_kurus), `kantin ${tl(k.month_pos_kurus)}`)}
        ${kpi('alert', 'Açık alacak', tl(k.receivable_kurus), 'gelecek etkinlikler', k.receivable_kurus > 0 ? 'warn' : '')}
        ${kpi('receipt', 'Bu ay gider', tl(k.month_expense_kurus), 'personel dahil')}
      </section>`
          : ''
      }

      <div class="grid-main">
        <section class="card">
          <header class="card-head"><h3>${icon('clock')} Yaklaşan organizasyonlar</h3><a href="#/rezervasyon" class="link">Takvim →</a></header>
          ${
            d.upcoming.length
              ? `<div class="event-list">${d.upcoming
                  .map((r) => {
                    const n = daysUntil(r.event_date);
                    return `
              <a class="event-row" href="#/rezervasyon/${r.id}">
                <div class="date-chip ${n === 0 ? 'today' : ''}"><strong>${r.event_date.slice(8, 10)}</strong><small>${new Date(r.event_date + 'T00:00:00').toLocaleDateString('tr-TR', { month: 'short' })}</small></div>
                <div class="grow"><strong>${esc(r.customer_name)}</strong><small class="muted block">${EVENT_TYPES[r.event_type] ?? esc(r.event_type)} · ${esc(r.hall_name)} · ${r.start_time}–${r.end_time}${r.guest_count ? ` · ${r.guest_count} kişi` : ''}</small></div>
                <div class="right">
                  <span class="badge st-${r.status}">${STATUS_LABELS[r.status]}</span>
                  ${canMoney ? `<small class="block ${r.balance_kurus > 0 ? 'warn-text' : 'ok-text'}">${r.balance_kurus > 0 ? 'Kalan ' + tl(r.balance_kurus) : 'Ödendi'}</small>` : ''}
                </div>
                <small class="when">${n === 0 ? 'Bugün' : n === 1 ? 'Yarın' : `${n} gün`}</small>
              </a>`;
                  })
                  .join('')}</div>`
              : '<p class="empty">30 gün içinde planlanmış organizasyon yok.</p>'
          }
        </section>

        <div class="stack">
          <section class="card">
            <header class="card-head"><h3>${icon('alert')} Hatırlatmalar</h3><span class="badge">${d.reminders.length}</span></header>
            ${
              d.reminders.length
                ? `<ul class="reminders">${d.reminders
                    .map((r) => `<li class="lvl-${r.level}"><a href="#/rezervasyon/${r.reservation_id}">${esc(r.text)}</a></li>`)
                    .join('')}</ul>`
                : `<p class="empty">${icon('check')} Her şey yolunda.</p>`
            }
          </section>
          ${
            canMoney
              ? `<section class="card">
            <header class="card-head"><h3>${icon('wallet')} Son tahsilatlar</h3></header>
            ${
              d.recent_payments.length
                ? `<table class="table compact"><tbody>${d.recent_payments
                    .map(
                      (p) => `<tr class="clickable" data-href="#/rezervasyon/${p.reservation_id}"><td>${esc(p.customer_name)}<small class="block muted">${PAYMENT_KINDS[p.kind]} · ${dateTimeTR(p.created_at)}</small></td>
                        <td class="num ${p.kind === 'iade' ? 'neg' : ''}">${p.kind === 'iade' ? '−' : ''}${tl(p.amount_kurus)}</td></tr>`,
                    )
                    .join('')}</tbody></table>`
                : '<p class="empty">Henüz tahsilat yok.</p>'
            }
          </section>`
              : ''
          }
        </div>
      </div>
      ${d.todays.length ? `<p class="muted small">Bugün: ${d.todays.map((r) => `${esc(r.customer_name)} (${esc(r.hall_name)} ${r.start_time})`).join(' · ')} — ${dateTR(d.today)}</p>` : ''}
      <span hidden>${dateShort(d.today)}</span>
    </div>`),
  );
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-href]');
    if (tr) window.location.hash = tr.dataset.href;
  });
}

function kpi(ic, label, value, sub, tone = '') {
  return `<div class="kpi card ${tone}"><span class="kpi-ico">${icon(ic, 20)}</span><div><small>${esc(label)}</small><strong>${value}</strong><small class="muted">${esc(sub)}</small></div></div>`;
}
