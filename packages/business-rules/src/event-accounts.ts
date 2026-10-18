/**
 * Kantin (organizasyon) hesabı bakiyesi: borç = veresiye satış + elle borç, tahsilat = alacak kayıtları.
 * Salondaki SQLite ile buluttaki D1 aynı sorguyu kullanır; böylece iki ekran aynı bakiyeyi gösterir.
 */
export const EVENT_ACCOUNT_BALANCE_SQL = `
  SELECT a.*, r.event_date,
         COALESCE(SUM(CASE l.entry_type WHEN 'borc' THEN l.amount_kurus END), 0) AS debit_kurus,
         COALESCE(SUM(CASE l.entry_type WHEN 'alacak' THEN l.amount_kurus END), 0) AS credit_kurus,
         COALESCE(SUM(CASE l.entry_type WHEN 'borc' THEN l.amount_kurus ELSE -l.amount_kurus END), 0) AS balance_kurus,
         MAX(l.created_at) AS last_entry_at
    FROM event_accounts a
    LEFT JOIN reservations r ON r.id = a.reservation_id
    LEFT JOIN event_ledger l ON l.event_account_id = a.id`;

export const EVENT_ACCOUNT_ORDER_SQL = 'GROUP BY a.id ORDER BY COALESCE(r.event_date, a.created_at) DESC';
