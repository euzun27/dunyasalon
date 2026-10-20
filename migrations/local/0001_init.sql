-- DUNYATEK Wedding ERP · Yerel (mini PC) şema v1
-- Tutarlar: tamsayı kuruş. Miktarlar: ×1000 ölçekli tamsayı.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','kasiyer','resepsiyon','muhasebe')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE halls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'adet',
  price_kurus INTEGER NOT NULL CHECK (price_kurus >= 0),
  vat_rate INTEGER NOT NULL DEFAULT 10,
  track_stock INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE inventory_balances (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at TEXT NOT NULL
);

-- Olay bazlı stok geçmişi: bakiye bu hareketlerin toplamıdır.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('giris','satis','iade','sayim','fire')),
  qty_delta INTEGER NOT NULL,
  unit_cost_kurus INTEGER,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at);

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  terminal TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  opening_cash_kurus INTEGER NOT NULL DEFAULT 0,
  closing_cash_kurus INTEGER,
  expected_cash_kurus INTEGER,
  opened_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE UNIQUE INDEX idx_cash_sessions_open ON cash_sessions(terminal) WHERE closed_at IS NULL;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  hall_id TEXT NOT NULL REFERENCES halls(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  event_type TEXT NOT NULL DEFAULT 'dugun',
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  guest_count INTEGER,
  price_kurus INTEGER NOT NULL DEFAULT 0,
  deposit_kurus INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('talep','opsiyon','kesin','iptal','tamamlandi')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'yerel',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reservations_hall_date ON reservations(hall_id, event_date);

-- Her organizasyonun (düğün) kantin/ek hizmet cari hesabı.
CREATE TABLE event_accounts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT UNIQUE REFERENCES reservations(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'acik' CHECK (status IN ('acik','kapali')),
  credit_limit_kurus INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- borc: müşteriye yazılan (ör. kantin satışı), alacak: müşteriden tahsil edilen.
CREATE TABLE event_ledger (
  id TEXT PRIMARY KEY,
  event_account_id TEXT NOT NULL REFERENCES event_accounts(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('borc','alacak')),
  amount_kurus INTEGER NOT NULL CHECK (amount_kurus > 0),
  description TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_event_ledger_account ON event_ledger(event_account_id, created_at);

CREATE TABLE pos_sales (
  id TEXT PRIMARY KEY,
  receipt_no INTEGER NOT NULL UNIQUE,
  terminal TEXT NOT NULL,
  cash_session_id TEXT REFERENCES cash_sessions(id),
  event_account_id TEXT REFERENCES event_accounts(id),
  subtotal_kurus INTEGER NOT NULL,
  discount_kurus INTEGER NOT NULL DEFAULT 0,
  total_kurus INTEGER NOT NULL,
  vat_kurus INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'tamamlandi' CHECK (status IN ('tamamlandi','iade')),
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pos_sales_created ON pos_sales(created_at);

CREATE TABLE pos_sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_kurus INTEGER NOT NULL,
  vat_rate INTEGER NOT NULL,
  line_total_kurus INTEGER NOT NULL
);
CREATE INDEX idx_pos_sale_items_sale ON pos_sale_items(sale_id);

CREATE TABLE pos_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id),
  method TEXT NOT NULL CHECK (method IN ('nakit','kart','dugun_hesabi')),
  amount_kurus INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pos_payments_sale ON pos_payments(sale_id);

-- Buluta gönderilecek olaylar. İş kaydıyla aynı transaction içinde yazılır.
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'bekliyor' CHECK (status IN ('bekliyor','gonderildi','hata')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  sent_at TEXT
);
CREATE INDEX idx_sync_outbox_pending ON sync_outbox(status, seq);

-- Buluttan alınan olaylar (tekilleştirme için event_id benzersiz).
CREATE TABLE sync_inbox (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'alindi' CHECK (status IN ('alindi','islendi','reddedildi')),
  error TEXT
);

CREATE TABLE sync_cursors (
  name TEXT PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
