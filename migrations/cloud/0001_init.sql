-- DUNYATEK Wedding ERP · Bulut (Cloudflare D1) şema v1
-- D1, salondaki mini PC'den gelen olayların kopyasını ve merkezi raporları tutar.
-- Salon işlemlerinin yetkili kaynağı mini PC'dir.

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

-- Değişmez olay günlüğü. event_id benzersiz olduğu için aynı olay iki kez işlenmez.
CREATE TABLE sync_events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  origin TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX idx_sync_events_origin ON sync_events(origin, cursor);

CREATE TABLE halls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL,
  price_kurus INTEGER NOT NULL,
  vat_rate INTEGER NOT NULL,
  track_stock INTEGER NOT NULL,
  active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,
  qty_delta INTEGER NOT NULL,
  unit_cost_kurus INTEGER,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);

-- Bulutta stok bakiyesi kopyalanmaz; hareketlerden türetilir.
CREATE VIEW inventory_balances AS
  SELECT product_id, SUM(qty_delta) AS qty FROM stock_movements GROUP BY product_id;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  hall_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  guest_count INTEGER,
  price_kurus INTEGER NOT NULL,
  deposit_kurus INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  source TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reservations_date ON reservations(event_date);

-- Mini PC'ye ulaşılamadığında uzaktan yalnızca talep alınır; kesinleştirme yerelde yapılır.
CREATE TABLE reservation_requests (
  id TEXT PRIMARY KEY,
  hall_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  guest_count INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'bekliyor',
  created_at TEXT NOT NULL
);

CREATE TABLE event_accounts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  credit_limit_kurus INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_ledger (
  id TEXT PRIMARY KEY,
  event_account_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL,
  description TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_event_ledger_account ON event_ledger(event_account_id);

CREATE TABLE pos_sales (
  id TEXT PRIMARY KEY,
  receipt_no INTEGER NOT NULL,
  terminal TEXT NOT NULL,
  cash_session_id TEXT,
  event_account_id TEXT,
  subtotal_kurus INTEGER NOT NULL,
  discount_kurus INTEGER NOT NULL,
  total_kurus INTEGER NOT NULL,
  vat_kurus INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pos_sales_created ON pos_sales(created_at);

CREATE TABLE pos_sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_kurus INTEGER NOT NULL,
  vat_rate INTEGER NOT NULL,
  line_total_kurus INTEGER NOT NULL
);
CREATE INDEX idx_pos_sale_items_sale ON pos_sale_items(sale_id);

CREATE TABLE pos_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
