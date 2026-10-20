-- Bulut: salon yönetim modülleri (yerel 0002 ile aynı tablolar, kısıtsız kopya)
ALTER TABLE reservations ADD COLUMN option_until TEXT;
ALTER TABLE reservations ADD COLUMN discount_kurus INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN national_id TEXT;

CREATE TABLE services (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, pricing TEXT NOT NULL, price_kurus INTEGER NOT NULL,
  description TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE reservation_items (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, service_id TEXT, name TEXT NOT NULL, pricing TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_kurus INTEGER NOT NULL, total_kurus INTEGER NOT NULL, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_reservation_items_res ON reservation_items(reservation_id);
CREATE TABLE reservation_payments (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, receipt_no INTEGER NOT NULL, kind TEXT NOT NULL, method TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL, note TEXT, user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  cancelled_at TEXT, cancel_reason TEXT
);
CREATE INDEX idx_reservation_payments_res ON reservation_payments(reservation_id);
CREATE TABLE reservation_installments (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, due_date TEXT NOT NULL, amount_kurus INTEGER NOT NULL, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE finance_entries (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL, amount_kurus INTEGER NOT NULL, method TEXT NOT NULL,
  description TEXT, reservation_id TEXT, entry_date TEXT NOT NULL, user_id TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_finance_entries_date ON finance_entries(entry_date);
CREATE TABLE staff (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT, title TEXT, daily_wage_kurus INTEGER NOT NULL,
  active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE event_staff (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, staff_id TEXT NOT NULL, task TEXT, wage_kurus INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE customer_notes (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, reservation_id TEXT, note TEXT NOT NULL, user_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
