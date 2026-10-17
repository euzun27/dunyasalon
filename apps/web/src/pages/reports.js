import { api } from '../services/api.js';
import { esc, tl, EVENT_TYPES } from '../services/format.js';
import { h, errorToast } from '../ui.js';
import { icon } from '../icons.js';

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export async function renderReports(root) {
  let year = String(new Date().getFullYear());
  root.append(
    h(`
    <div class="page">
      <div class="page-head">
        <div class="actions">
          <button class="icon-btn" id="prev" aria-label="Önceki yıl">‹</button>
          <strong id="year" class="month-label">${year}</strong>
          <button class="icon-btn" id="next" aria-label="Sonraki yıl">›</button>
        </div>
        <div class="actions">
          <a class="btn ghost" href="#/kantin-raporu">${icon('receipt', 16)} Günlük kantin raporu</a>
          <button class="btn ghost" id="print">${icon('print', 16)} Yazdır</button>
        </div>
      </div>
      <div id="body" class="page-flow"></div>
    </div>`),
  );
  const body = root.querySelector('#body');

  async function load() {
    root.querySelector('#year').textContent = year;
    try {
      const r = await api('/reports/yearly', { query: { year } });
      const t = r.totals;
      const income = r.series.collected.map((v, i) => v + r.series.pos[i] + r.series.other_income[i]);
      const wd = Object.fromEntries(r.by_weekday.map((w) => [Number(w.wd), w.count]));
      const wdMax = Math.max(1, ...Object.values(wd));
      body.innerHTML = `
        <section class="kpis">
          ${kpi('calendar', 'Etkinlik', t.events, `${t.cancelled} iptal`)}
          ${kpi('doc', 'Sözleşme tutarı', tl(t.contract_kurus), 'kesin + tamamlanan')}
          ${kpi('wallet', 'Tahsilat', tl(t.collected_kurus), `kantin ${tl(t.pos_kurus)}`)}
          ${kpi('receipt', 'Gider', tl(t.expense_kurus), 'personel dahil')}
          ${kpi('chart', 'Net', tl(t.net_kurus), 'tahsilat + kantin + diğer − gider', t.net_kurus >= 0 ? 'ok' : 'danger')}
        </section>
        <section class="card">
          <header class="card-head"><h3>${icon('chart')} Aylık gelir ve gider</h3>
            <div class="legend"><span><i class="dot" style="background:var(--primary)"></i>Gelir</span><span><i class="dot" style="background:var(--gold)"></i>Gider</span></div></header>
          ${barChart([income, r.series.expense], ['var(--primary)', 'var(--gold)'], tl)}
        </section>
        <div class="split">
          <section class="card">
            <header class="card-head"><h3>${icon('calendar')} Aylık etkinlik sayısı</h3></header>
            ${barChart([r.series.events], ['var(--primary)'], (v) => String(v), 440)}
          </section>
          <section class="card">
            <header class="card-head"><h3>Haftanın günlerine göre</h3></header>
            <div class="bars">${[1, 2, 3, 4, 5, 6, 0].map((d) => bar(WEEKDAYS[d], wd[d] ?? 0, wdMax, String(wd[d] ?? 0))).join('')}</div>
          </section>
          <section class="card">
            <header class="card-head"><h3>Etkinlik türleri</h3></header>
            ${table(r.by_type.map((x) => [EVENT_TYPES[x.event_type] ?? x.event_type, x.count, x.total]))}
          </section>
          <section class="card">
            <header class="card-head"><h3>Salonlar</h3></header>
            ${table(r.by_hall.map((x) => [x.hall_name, x.count, x.total]))}
          </section>
        </div>
        <section class="card">
          <header class="card-head"><h3>Aylık döküm</h3></header>
          <div class="table-wrap"><table class="table compact">
            <thead><tr><th>Ay</th><th class="num">Etkinlik</th><th class="num">Sözleşme</th><th class="num">Tahsilat</th><th class="num">Kantin</th><th class="num">Diğer gelir</th><th class="num">Gider</th><th class="num">Net</th></tr></thead>
            <tbody>${r.months
              .map((m, i) => {
                const net = income[i] - r.series.expense[i];
                return `<tr><td>${MONTHS[i]}</td><td class="num">${r.series.events[i]}</td><td class="num">${tl(r.series.contract[i])}</td><td class="num">${tl(r.series.collected[i])}</td><td class="num">${tl(r.series.pos[i])}</td><td class="num">${tl(r.series.other_income[i])}</td><td class="num">${tl(r.series.expense[i])}</td><td class="num ${net < 0 ? 'neg' : ''}"><strong>${tl(net)}</strong></td></tr>`;
              })
              .join('')}</tbody>
          </table></div>
        </section>`;
    } catch (e) {
      errorToast(e);
    }
  }

  root.querySelector('#prev').addEventListener('click', () => ((year = String(Number(year) - 1)), load()));
  root.querySelector('#next').addEventListener('click', () => ((year = String(Number(year) + 1)), load()));
  root.querySelector('#print').addEventListener('click', () => window.print());
  await load();
}

/** Gruplu çubuk grafik (SVG). series: sayı dizileri, 12 ay. */
function barChart(series, colors, fmt, W = 720) {
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...series.flat());
  const slot = (W - pad.l - pad.r) / 12;
  const bw = Math.min(22, (slot - 8) / series.length);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const bars = series
    .map((s, si) =>
      s
        .map((v, i) => {
          const x = pad.l + slot * i + (slot - bw * series.length) / 2 + bw * si;
          const top = y(v);
          return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - top).toFixed(1)}" rx="3" fill="${colors[si]}"><title>${MONTHS[i]}: ${esc(fmt(v))}</title></rect>`;
        })
        .join(''),
    )
    .join('');
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`)
    .join('');
  const labels = MONTHS.map((m, i) => `<text x="${pad.l + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${m}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${labels}</svg>
    <p class="muted small chart-max">En yüksek: ${esc(fmt(max))}</p>`;
}

function bar(label, v, max, text) {
  return `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i style="width:${v ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></i></div><strong>${esc(text)}</strong></div>`;
}

function table(rows) {
  if (!rows.length) return '<p class="empty">Bu yıl veri yok.</p>';
  return `<table class="table compact"><thead><tr><th></th><th class="num">Adet</th><th class="num">Tutar</th></tr></thead><tbody>${rows
    .map(([a, n, t]) => `<tr><td>${esc(a)}</td><td class="num">${n}</td><td class="num">${tl(t)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function kpi(ic, label, value, sub, tone = '') {
  return `<div class="kpi card ${tone}"><span class="kpi-ico">${icon(ic, 20)}</span><div><small>${esc(label)}</small><strong>${value}</strong><small class="muted">${esc(sub)}</small></div></div>`;
}
