import { all, one, type DB } from '../database/db.ts';
import { listReservations } from './reservations.ts';

const trDate = (d: string) => d.split('-').reverse().join('.');

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

/** Ana sayfa: bugünün ve yaklaşan etkinlikler, bekleyen tahsilat, hatırlatmalar. */
export function dashboard(db: DB, today = new Date().toISOString().slice(0, 10)) {
  const month = today.slice(0, 7);
  const upcoming = listReservations(db, { from: today, to: addDays(today, 30) }).filter((r) => r.status !== 'iptal');
  const todays = upcoming.filter((r) => r.event_date === today);

  const monthStats = one<{ events: number; total: number | null }>(
    db,
    `SELECT COUNT(*) AS events, SUM(r.price_kurus - r.discount_kurus
            + (SELECT COALESCE(SUM(i.total_kurus), 0) FROM reservation_items i WHERE i.reservation_id = r.id)) AS total
       FROM reservations r WHERE r.status IN ('kesin','tamamlandi') AND substr(r.event_date, 1, 7) = ?`,
    month,
  )!;
  const monthCollected = one<{ t: number | null }>(
    db,
    `SELECT SUM(CASE kind WHEN 'iade' THEN -amount_kurus ELSE amount_kurus END) AS t FROM reservation_payments
      WHERE cancelled_at IS NULL AND substr(created_at, 1, 7) = ?`,
    month,
  )!.t ?? 0;
  const monthPos = one<{ t: number | null }>(
    db, "SELECT SUM(total_kurus) AS t FROM pos_sales WHERE status = 'tamamlandi' AND substr(created_at, 1, 7) = ?", month)!.t ?? 0;
  const monthExpense =
    (one<{ t: number | null }>(db, "SELECT SUM(amount_kurus) AS t FROM finance_entries WHERE type = 'gider' AND deleted_at IS NULL AND substr(entry_date, 1, 7) = ?", month)!.t ?? 0) +
    (one<{ t: number | null }>(
      db,
      `SELECT SUM(es.wage_kurus) AS t FROM event_staff es JOIN reservations r ON r.id = es.reservation_id
        WHERE es.deleted_at IS NULL AND r.status != 'iptal' AND substr(r.event_date, 1, 7) = ?`,
      month,
    )!.t ?? 0);

  // Açık bakiyesi olan gelecek (ve bugünkü) kesin/opsiyon rezervasyonlar
  const open = listReservations(db, { from: today }).filter((r) => ['kesin', 'opsiyon'].includes(r.status));
  const receivable = open.reduce((s, r) => s + Math.max(0, r.balance_kurus), 0);

  const reminders: Array<{ kind: string; level: 'info' | 'warn' | 'danger'; text: string; reservation_id: string; date: string }> = [];
  for (const r of listReservations(db, { from: addDays(today, -30), to: addDays(today, 365) })) {
    if (r.status === 'opsiyon' && r.option_until && r.option_until <= addDays(today, 3)) {
      reminders.push({
        kind: 'opsiyon',
        level: r.option_until < today ? 'danger' : 'warn',
        text: `${r.customer_name}: opsiyon ${r.option_until < today ? 'süresi doldu' : 'bitiyor'} (${trDate(r.option_until)})`,
        reservation_id: r.id,
        date: r.option_until,
      });
    }
    if (r.status === 'kesin' && r.event_date >= today && r.event_date <= addDays(today, 7) && r.balance_kurus > 0) {
      reminders.push({ kind: 'bakiye', level: 'warn', text: `${r.customer_name}: ${daysBetween(today, r.event_date) === 0 ? 'etkinlik bugün' : `etkinliğe ${daysBetween(today, r.event_date)} gün var`}, kalan ödeme açık`, reservation_id: r.id, date: r.event_date });
    }
    if (r.status === 'kesin' && r.event_date >= today && r.event_date <= addDays(today, 10) && !r.guest_count) {
      reminders.push({ kind: 'davetli', level: 'info', text: `${r.customer_name}: davetli sayısı girilmemiş`, reservation_id: r.id, date: r.event_date });
    }
    if (r.status === 'kesin' && r.event_date < today) {
      reminders.push({ kind: 'kapanis', level: 'info', text: `${r.customer_name}: geçmiş etkinlik "tamamlandı" olarak kapatılmadı`, reservation_id: r.id, date: r.event_date });
    }
  }
  const overdue = all<{ reservation_id: string; customer_name: string; due_date: string; amount_kurus: number }>(
    db,
    `SELECT i.reservation_id, c.full_name AS customer_name, i.due_date, i.amount_kurus
       FROM reservation_installments i JOIN reservations r ON r.id = i.reservation_id JOIN customers c ON c.id = r.customer_id
      WHERE i.deleted_at IS NULL AND i.due_date <= ? AND r.status IN ('kesin','opsiyon') ORDER BY i.due_date`,
    today,
  );
  for (const o of overdue) {
    const r = open.find((x) => x.id === o.reservation_id);
    if (r && r.balance_kurus > 0) {
      reminders.push({ kind: 'vade', level: 'danger', text: `${o.customer_name}: ${trDate(o.due_date)} vadeli ödeme gecikti`, reservation_id: o.reservation_id, date: o.due_date });
    }
  }
  const seen = new Set<string>();
  const uniqueReminders = reminders
    .filter((r) => (seen.has(r.kind + r.reservation_id) ? false : (seen.add(r.kind + r.reservation_id), true)))
    .sort((a, b) => ({ danger: 0, warn: 1, info: 2 })[a.level] - ({ danger: 0, warn: 1, info: 2 })[b.level] || a.date.localeCompare(b.date));

  const recentPayments = all(
    db,
    `SELECT p.id, p.receipt_no, p.kind, p.method, p.amount_kurus, p.created_at, c.full_name AS customer_name, p.reservation_id
       FROM reservation_payments p JOIN reservations r ON r.id = p.reservation_id JOIN customers c ON c.id = r.customer_id
      WHERE p.cancelled_at IS NULL ORDER BY p.created_at DESC LIMIT 8`,
  );
  const pendingRequests = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'talep' AND event_date >= ?", today)!.n;

  return {
    today,
    todays,
    upcoming: upcoming.slice(0, 12),
    kpis: {
      month_events: monthStats.events,
      month_contract_kurus: monthStats.total ?? 0,
      month_collected_kurus: monthCollected,
      month_pos_kurus: monthPos,
      month_expense_kurus: monthExpense,
      receivable_kurus: receivable,
      upcoming_30_days: upcoming.length,
      pending_requests: pendingRequests,
    },
    reminders: uniqueReminders.slice(0, 20),
    recent_payments: recentPayments,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
}
