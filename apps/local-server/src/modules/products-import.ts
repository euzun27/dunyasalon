import { toQty, ValidationError } from '@dunyatek/shared';
import { one, tx, type DB } from '../database/db.ts';
import { audit } from '../database/outbox.ts';
import { recordManualMovement } from './inventory.ts';
import { createProduct, updateProduct, type ProductWithStock } from './products.ts';

/**
 * Excel/CSV'den toplu ürün yükleme. Satırlar tarayıcıda okunur, ham hücre değerleriyle buraya gelir.
 * Barkod varsa barkoda, yoksa ürün adına göre eşleşir: eşleşen ürünün adı, kategorisi, fiyatı ve KDV'si
 * güncellenir, eşleşmeyen yeni ürün olarak eklenir. Stok sütunu doluysa o kadar "giriş" hareketi yazılır.
 * Hatalı satırlar atlanır ve raporda satır numarasıyla bildirilir; geçerli satırlar tek işlemde kaydedilir.
 */
export interface ImportRow {
  barcode?: unknown;
  name?: unknown;
  category?: unknown;
  price?: unknown;
  vat_rate?: unknown;
  stock?: unknown;
  unit?: unknown;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  stock_entries: number;
  errors: Array<{ row: number; message: string }>;
}

export const IMPORT_MAX_ROWS = 5000;

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** "1.250,50 ₺", "12,5", "12.50" ya da 12.5 → kuruş. Boş ise null. */
export function parseMoneyCell(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  let s = text(v).replace(/₺|TL|tl|\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function parseNumberCell(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = text(v).replace('%', '').replace(',', '.').replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Excel barkodu sayı olarak saklayınca 8,69E+12 gibi bilimsel gösterime ya da ".0" sonekine düşebilir. */
function barcodeCell(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : null;
  const s = text(v).replace(/\s/g, '');
  if (!s) return null;
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super('dry-run');
  }
}

export function importProducts(db: DB, rows: ImportRow[], opts: { dryRun?: boolean; firstRow?: number }, userId: string | null): ImportReport {
  if (!Array.isArray(rows) || rows.length === 0) throw new ValidationError('Dosyada ürün satırı bulunamadı');
  if (rows.length > IMPORT_MAX_ROWS) throw new ValidationError(`Bir seferde en fazla ${IMPORT_MAX_ROWS} satır yüklenebilir`);
  const report: ImportReport = { total: rows.length, created: 0, updated: 0, unchanged: 0, stock_entries: 0, errors: [] };
  const seen = new Map<string, number>();

  const run = () => {
    rows.forEach((raw, i) => {
      // Kullanıcıya Excel'deki satır numarasını göster (varsayılan: 1. satır başlık)
      const rowNo = i + (opts.firstRow ?? 2);
      try {
        const name = text(raw.name);
        if (!name) {
          if (!text(raw.barcode) && !text(raw.price)) return void report.total--; // tamamen boş satır
          throw new ValidationError('Ürün adı boş');
        }
        const barcode = text(raw.barcode) ? barcodeCell(raw.barcode) : null;
        if (text(raw.barcode) && !barcode) throw new ValidationError('Barkod okunamadı; Excel\'de barkod sütununu "Metin" biçimine çevirin');
        const price = parseMoneyCell(raw.price);
        if (price === null) throw new ValidationError('Satış fiyatı boş');
        if (Number.isNaN(price) || price < 0) throw new ValidationError(`Satış fiyatı geçersiz: ${text(raw.price)}`);
        const vat = parseNumberCell(raw.vat_rate);
        if (Number.isNaN(vat) || (vat !== null && (vat < 0 || vat > 100 || !Number.isInteger(vat)))) {
          throw new ValidationError(`KDV oranı geçersiz: ${text(raw.vat_rate)}`);
        }
        const stock = parseNumberCell(raw.stock);
        if (Number.isNaN(stock) || (stock !== null && stock < 0)) throw new ValidationError(`Stok miktarı geçersiz: ${text(raw.stock)}`);

        const key = barcode ?? `ad:${name.toLocaleLowerCase('tr')}`;
        if (seen.has(key)) throw new ValidationError(`Aynı ürün ${seen.get(key)}. satırda da var`);
        seen.set(key, rowNo);

        const existing = barcode
          ? one<ProductWithStock>(db, 'SELECT * FROM products WHERE barcode = ?', barcode)
          : one<ProductWithStock>(db, 'SELECT * FROM products WHERE barcode IS NULL AND lower(name) = lower(?)', name);
        const input = {
          barcode,
          name,
          category: text(raw.category) || existing?.category || null,
          unit: text(raw.unit) || existing?.unit || 'adet',
          price_kurus: price,
          vat_rate: vat ?? existing?.vat_rate ?? 10,
          track_stock: existing ? existing.track_stock === 1 : true,
          active: true,
        };
        let productId: string;
        if (existing) {
          const same =
            existing.name === input.name && existing.category === input.category && existing.unit === input.unit &&
            existing.price_kurus === input.price_kurus && existing.vat_rate === input.vat_rate && existing.active === 1;
          if (same) report.unchanged++;
          else {
            updateProduct(db, existing.id, input, userId);
            report.updated++;
          }
          productId = existing.id;
        } else {
          productId = createProduct(db, input, userId).id;
          report.created++;
        }
        if (stock) {
          recordManualMovement(db, { product_id: productId, type: 'giris', qty: toQty(stock), note: 'Excel ile toplu yükleme' }, userId);
          report.stock_entries++;
        }
      } catch (err) {
        if (!(err instanceof Error) || !('status' in err)) throw err;
        report.errors.push({ row: rowNo, message: err.message });
      }
    });
    if (opts.dryRun) throw new DryRun(report);
    audit(db, userId, 'product.import', 'product', 'toplu', {
      created: report.created, updated: report.updated, stock_entries: report.stock_entries, errors: report.errors.length,
    });
  };

  try {
    tx(db, run);
  } catch (err) {
    if (err instanceof DryRun) return err.report;
    throw err;
  }
  return report;
}
