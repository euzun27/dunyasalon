-- DUNYATEK Wedding ERP · Salon yönetim modülleri
-- Menü/hizmet/paket, rezervasyon kalemleri, tahsilat ve ödeme planı, gelir-gider,
-- personel, müşteri görüşmeleri, mesaj şablonları ve işletme ayarları.

ALTER TABLE reservations ADD COLUMN option_until TEXT;          -- opsiyon bitiş tarihi
ALTER TABLE reservations ADD COLUMN discount_kurus INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN national_id TEXT;              -- sözleşme için T.C. kimlik no (isteğe bağlı)

-- Menü, hizmet ve paket tanımları
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('menu','hizmet','paket')),
  pricing TEXT NOT NULL CHECK (pricing IN ('sabit','kisi_basi')),
  price_kurus INTEGER NOT NULL CHECK (price_kurus >= 0),
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Rezervasyona eklenen menü/hizmet/paket satırları (fiyat o anki değerle saklanır)
CREATE TABLE reservation_items (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  service_id TEXT REFERENCES services(id),
  name TEXT NOT NULL,
  pricing TEXT NOT NULL CHECK (pricing IN ('sabit','kisi_basi')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_kurus INTEGER NOT NULL CHECK (unit_price_kurus >= 0),
  total_kurus INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reservation_items_res ON reservation_items(reservation_id);

-- Rezervasyon tahsilatları (kapora, ara ödeme, kalan ödeme). İptal edilen satır silinmez.
CREATE TABLE reservation_payments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  receipt_no INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('kapora','ara_odeme','kalan','iade')),
  method TEXT NOT NULL CHECK (method IN ('nakit','kart','havale')),
  amount_kurus INTEGER NOT NULL CHECK (amount_kurus > 0),
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX idx_reservation_payments_res ON reservation_payments(reservation_id);
CREATE INDEX idx_reservation_payments_created ON reservation_payments(created_at);

-- Ödeme planı (taksitler / vadeler)
CREATE TABLE reservation_installments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  due_date TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL CHECK (amount_kurus > 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_reservation_installments_due ON reservation_installments(due_date);

-- Kantin ve rezervasyon tahsilatı dışındaki gelir ve giderler
CREATE TABLE finance_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('gelir','gider')),
  category TEXT NOT NULL,
  amount_kurus INTEGER NOT NULL CHECK (amount_kurus > 0),
  method TEXT NOT NULL DEFAULT 'nakit' CHECK (method IN ('nakit','kart','havale')),
  description TEXT,
  reservation_id TEXT REFERENCES reservations(id),
  entry_date TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_finance_entries_date ON finance_entries(entry_date);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  title TEXT,
  daily_wage_kurus INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Organizasyonlara personel ataması (görev ve yevmiye maliyeti)
CREATE TABLE event_staff (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  task TEXT,
  wage_kurus INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (reservation_id, staff_id)
);

-- Müşteri görüşmeleri ve notlar
CREATE TABLE customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  reservation_id TEXT REFERENCES reservations(id),
  note TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);

CREATE TABLE message_templates (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE message_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  reservation_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms')),
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO message_templates (key, title, body) VALUES
 ('rezervasyon_onay', 'Rezervasyon onayı',
  'Sayın {musteri}, {tarih} tarihli {etkinlik} organizasyonunuz {salon} için {saat} saatinde kesinleşmiştir. Toplam: {toplam}, ödenen: {odenen}, kalan: {kalan}. {isletme}'),
 ('opsiyon_hatirlatma', 'Opsiyon hatırlatma',
  'Sayın {musteri}, {tarih} tarihi için {salon} opsiyonunuz {opsiyon_bitis} tarihinde sona erecektir. Kesinleştirmek için bize ulaşabilirsiniz. {isletme} {isletme_tel}'),
 ('odeme_hatirlatma', 'Ödeme hatırlatma',
  'Sayın {musteri}, {tarih} tarihli organizasyonunuz için kalan ödemeniz {kalan}. Bilgilerinize sunarız. {isletme} {isletme_tel}'),
 ('etkinlik_hatirlatma', 'Etkinlik hatırlatma',
  'Sayın {musteri}, {tarih} {saat} tarihindeki {etkinlik} organizasyonunuz yaklaşıyor. Davetli sayısı ve son detaylar için sizi bekliyoruz. {isletme}'),
 ('tahsilat_makbuz', 'Tahsilat bilgisi',
  'Sayın {musteri}, {tutar} tutarındaki ödemeniz alınmıştır (makbuz no {makbuz}). Kalan bakiye: {kalan}. Teşekkür ederiz. {isletme}');

INSERT OR IGNORE INTO settings (key, value) VALUES
 ('business.name', 'DÜNYA DÜĞÜN SALONU'),
 ('business.phone', ''),
 ('business.address', ''),
 ('business.tax', ''),
 ('contract.terms', '1. Kapora iade edilmez; organizasyon tarihi değişikliği en geç 60 gün önce yazılı olarak bildirilir.
2. Kalan ödeme organizasyon tarihinden en geç 7 gün önce tamamlanır.
3. Davetli sayısı organizasyondan en geç 10 gün önce kesinleştirilir; menü fiyatı kesinleşen sayı üzerinden hesaplanır.
4. Salona dışarıdan yiyecek-içecek getirilmesi işletmenin onayına tabidir.
5. Salon eşyalarına verilen zarar kiralayan tarafından karşılanır.
6. Organizasyon belirtilen saatlerde başlar ve biter; uzama ek ücrete tabidir.
7. Mücbir sebepler dışında işletmenin iptali hâlinde alınan tüm ödemeler iade edilir.');
