/**
 * İlk kurulum: yönetici kullanıcı, salon ve örnek kantin ürünleri.
 * Kullanım: ADMIN_PASSWORD=... npm run seed -w @dunyatek/local-server [-- --demo]
 */
import { toQty } from '@dunyatek/shared';
import { loadConfig } from './config.ts';
import { one, openDatabase } from './database/db.ts';
import { createUser } from './modules/auth.ts';
import { createProduct } from './modules/products.ts';
import { recordManualMovement } from './modules/inventory.ts';
import { createHall } from './modules/reservations.ts';
import { saveService } from './modules/services.ts';
import { saveStaff } from './modules/staff.ts';

const config = loadConfig();
const db = openDatabase(config.dbPath);

if (!one(db, "SELECT id FROM users WHERE role = 'admin'")) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('İlk yönetici için ADMIN_PASSWORD ortam değişkenini verin.');
    process.exit(1);
  }
  createUser(db, { username: process.env.ADMIN_USER ?? 'admin', full_name: 'Yönetici', role: 'admin', password });
  console.log('Yönetici kullanıcı oluşturuldu.');
}

if (process.argv.includes('--demo')) {
  if (!one(db, 'SELECT id FROM halls')) {
    createHall(db, { name: 'Büyük Salon', capacity: 600 }, null);
    createHall(db, { name: 'Bahçe', capacity: 300 }, null);
  }
  const demo = [
    ['8690504000011', 'Su 0,5 L', 'İçecek', 1500],
    ['8690504000028', 'Kola 330 ml', 'İçecek', 4000],
    ['8690504000035', 'Ayran 300 ml', 'İçecek', 3000],
    ['8690504000042', 'Meyve Suyu 200 ml', 'İçecek', 3500],
    ['8690504000059', 'Çikolata', 'Atıştırmalık', 4500],
    ['8690504000066', 'Cips', 'Atıştırmalık', 5000],
    ['8690504000073', 'Lokum Kutusu', 'Hediyelik', 25000],
  ] as const;
  for (const [barcode, name, category, price] of demo) {
    if (one(db, 'SELECT id FROM products WHERE barcode = ?', barcode)) continue;
    const p = createProduct(db, { barcode, name, category, price_kurus: price, vat_rate: 10 }, null);
    recordManualMovement(db, { product_id: p.id, type: 'giris', qty: toQty(100), note: 'Açılış stoku' }, null);
  }
  if (!one(db, 'SELECT id FROM services')) {
    const services = [
      ['Altın Paket (salon + yemek + süsleme)', 'paket', 'kisi_basi', 120000, 'Salon, akşam yemeği, masa süslemesi, ses-ışık'],
      ['Akşam yemeği menüsü', 'menu', 'kisi_basi', 65000, 'Çorba, ara sıcak, et yemeği, pilav, salata, tatlı'],
      ['Kokteyl menüsü', 'menu', 'kisi_basi', 35000, 'Kuru pasta, kanepe, meşrubat'],
      ['Düğün pastası (5 kat)', 'hizmet', 'sabit', 750000, null],
      ['Gelin masası süsleme', 'hizmet', 'sabit', 500000, null],
      ['Orkestra / DJ', 'hizmet', 'sabit', 1500000, null],
      ['Fotoğraf ve video', 'hizmet', 'sabit', 1200000, null],
    ] as const;
    for (const [name, kind, pricing, price_kurus, description] of services) {
      saveService(db, null, { name, kind, pricing, price_kurus, description }, null);
    }
    for (const [full_name, title, wage] of [['Ahmet Yılmaz', 'Şef garson', 150000], ['Mehmet Kaya', 'Garson', 100000], ['Ayşe Demir', 'Aşçı', 180000]] as const) {
      saveStaff(db, null, { full_name, title, daily_wage_kurus: wage }, null);
    }
  }
  console.log('Örnek salon, ürün, menü/hizmet ve personel eklendi.');
}
db.close();
