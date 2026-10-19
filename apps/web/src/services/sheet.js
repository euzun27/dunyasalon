/**
 * Excel (.xlsx) ve CSV dosyasını satır dizisine çevirir. Kütüphane kullanmaz: .xlsx bir zip arşividir,
 * tarayıcının DecompressionStream'i ile açılır ve ilk sayfanın XML'i okunur. Böylece internet olmadan da çalışır.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Dosya bir Excel (.xlsx) dosyası değil');
  const files = new Map();
  let p = u32(b, eocd + 16);
  const n = u16(b, eocd + 10);
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + u16(b, f.local + 26) + u16(b, f.local + 28);
    const data = b.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8) throw new Error('Desteklenmeyen Excel sıkıştırması');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(buf) {
  const read = await unzip(buf);
  const wb = xml((await read('xl/workbook.xml')) ?? '');
  const firstSheet = byTag(wb, 'sheet')[0];
  if (!firstSheet) throw new Error('Excel dosyasında sayfa bulunamadı');
  const relId = firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = xml((await read('xl/_rels/workbook.xml.rels')) ?? '');
  const target = byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const shared = (await read('xl/sharedStrings.xml')) ?? '';
  const strings = shared ? byTag(xml(shared), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : [];
  const sheet = xml((await read(path)) ?? '');
  const rows = [];
  for (const row of byTag(sheet, 'row')) {
    const out = [];
    for (const c of byTag(row, 'c')) {
      const type = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = byTag(c, 't').map((t) => t.textContent).join('');
      else if (type === 'str' || type === 'b' || type === 'e') value = v;
      else value = v === '' ? '' : Number(v);
      out[colIndex(c.getAttribute('r') ?? 'A')] = value;
    }
    // Boş satırlar XML'de yer almaz; satır numarası Excel'deki ile aynı kalsın diye r özniteliğine göre yerleştir
    const r = Number(row.getAttribute('r')) || rows.length + 1;
    rows[r - 1] = Array.from(out, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

function readCsv(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  // Türkçe Windows Excel'in "CSV" kaydı UTF-8 değil Windows-1254 olabilir
  if (text.includes('�')) text = new TextDecoder('windows-1254').decode(buf);
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

/** Dosyayı okur ve [[hücre, ...], ...] döndürür; ilk satır başlıktır. */
export async function readSheet(file) {
  const buf = await file.arrayBuffer();
  if (/\.csv$|\.txt$/i.test(file.name)) return readCsv(buf);
  if (/\.xls$/i.test(file.name)) throw new Error('Eski .xls biçimi okunamıyor. Excel\'de "Farklı kaydet > Excel Çalışma Kitabı (.xlsx)" ile kaydedin.');
  return readXlsx(buf);
}

const norm = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/[()₺%.*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Ürün yükleme şablonunun başlıkları; farklı yazımlar da tanınır. */
const HEADERS = {
  barcode: ['barkod', 'barkod no', 'barcode', 'ean'],
  name: ['ürün adı', 'ürün', 'ad', 'adı', 'ürün ismi', 'stok adı', 'name'],
  category: ['kategori', 'grup', 'ürün grubu', 'category'],
  price: ['satış fiyatı', 'fiyat', 'satış fiyatı tl', 'birim fiyat', 'price'],
  vat_rate: ['kdv', 'kdv oranı', 'kdv %', 'vat'],
  stock: ['stok', 'stok adet', 'stok miktarı', 'açılış stoku', 'miktar', 'adet'],
  unit: ['birim', 'unit'],
};

/** Başlık satırına göre sütunları eşler; firstRow, ilk ürün satırının Excel'deki satır numarasıdır. */
export function productRows(rows) {
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() !== ''));
  if (headerIdx < 0) throw new Error('Dosya boş');
  const header = rows[headerIdx].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.name === undefined || col.price === undefined) {
    throw new Error('Başlık satırında en az "Ürün adı" ve "Satış fiyatı" sütunları olmalı. Şablonu indirip onu kullanın.');
  }
  return {
    firstRow: headerIdx + 2,
    rows: rows.slice(headerIdx + 1).map((r) => Object.fromEntries(Object.entries(col).map(([key, i]) => [key, r[i] ?? '']))),
  };
}
