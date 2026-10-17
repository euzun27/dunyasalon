import type { SyncEvent } from '@dunyatek/sync-protocol';

/**
 * Yerelden gelen olayı D1 projeksiyon tablolarına çeviren SQL ifadeleri.
 * Tümü sync_events kaydıyla aynı batch() içinde, atomik olarak çalışır.
 */

type Row = Record<string, unknown>;

const COLUMNS: Record<string, string[]> = {
  halls: ['id', 'name', 'capacity', 'active', 'created_at', 'updated_at'],
  customers: ['id', 'full_name', 'phone', 'email', 'notes', 'created_at', 'updated_at'],
  products: ['id', 'barcode', 'name', 'category', 'unit', 'price_kurus', 'vat_rate', 'track_stock', 'active', 'created_at', 'updated_at'],
  event_accounts: ['id', 'reservation_id', 'title', 'status', 'credit_limit_kurus', 'created_at', 'updated_at'],
  reservations: [
    'id', 'hall_id', 'customer_id', 'event_type', 'event_date', 'start_time', 'end_time', 'guest_count', 'price_kurus',
    'deposit_kurus', 'status', 'notes', 'source', 'version', 'created_by', 'created_at', 'updated_at',
  ],
  stock_movements: ['id', 'product_id', 'type', 'qty_delta', 'unit_cost_kurus', 'ref_type', 'ref_id', 'note', 'user_id', 'created_at'],
  event_ledger: ['id', 'event_account_id', 'entry_type', 'amount_kurus', 'description', 'ref_type', 'ref_id', 'user_id', 'created_at'],
  pos_sales: [
    'id', 'receipt_no', 'terminal', 'cash_session_id', 'event_account_id', 'subtotal_kurus', 'discount_kurus', 'total_kurus',
    'vat_kurus', 'status', 'note', 'user_id', 'created_at',
  ],
  pos_sale_items: ['id', 'sale_id', 'product_id', 'product_name', 'qty', 'unit_price_kurus', 'vat_rate', 'line_total_kurus'],
  pos_payments: ['id', 'sale_id', 'method', 'amount_kurus', 'created_at'],
};

function values(table: string, row: Row): unknown[] {
  const cols = COLUMNS[table]!;
  if (!row || typeof row.id !== 'string') throw new Error(`${table}: kayıt kimliği eksik`);
  return cols.map((c) => (row[c] === undefined ? null : row[c]));
}

/** Değişebilen kayıtlar: daha yeni (updated_at) sürüm eskisinin üzerine yazılır. */
function upsert(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const cols = COLUMNS[table]!;
  const set = cols.filter((c) => c !== 'id' && c !== 'created_at').map((c) => `${c} = excluded.${c}`).join(', ');
  return db
    .prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${set} WHERE excluded.updated_at >= ${table}.updated_at`,
    )
    .bind(...values(table, row));
}

/** Değişmez kayıtlar (hareketler, satış kalemleri): yalnızca ilk geliş yazılır. */
function insertOnce(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const cols = COLUMNS[table]!;
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO NOTHING`)
    .bind(...values(table, row));
}

export function projectionStatements(db: D1Database, e: SyncEvent): D1PreparedStatement[] {
  const p = e.payload as Row;
  switch (e.type) {
    case 'hall.upserted':
      return [upsert(db, 'halls', p)];
    case 'customer.upserted':
      return [upsert(db, 'customers', p)];
    case 'product.upserted':
      return [upsert(db, 'products', p)];
    case 'event_account.upserted':
      return [upsert(db, 'event_accounts', p)];
    case 'reservation.upserted':
      return [upsert(db, 'reservations', p)];
    case 'stock.moved':
      return [insertOnce(db, 'stock_movements', p)];
    case 'event_ledger.posted':
      return [insertOnce(db, 'event_ledger', p)];
    case 'sale.completed': {
      const s = p as { sale: Row; items: Row[]; payments: Row[]; stock_movements: Row[]; ledger: Row | null };
      return [
        insertOnce(db, 'pos_sales', s.sale),
        ...s.items.map((r) => insertOnce(db, 'pos_sale_items', r)),
        ...s.payments.map((r) => insertOnce(db, 'pos_payments', r)),
        ...s.stock_movements.map((r) => insertOnce(db, 'stock_movements', r)),
        ...(s.ledger ? [insertOnce(db, 'event_ledger', s.ledger)] : []),
      ];
    }
    case 'sale.refunded': {
      const r = p as { sale_id: string; stock_movements: Row[]; ledger: Row | null };
      return [
        db.prepare("UPDATE pos_sales SET status = 'iade' WHERE id = ?").bind(r.sale_id),
        ...r.stock_movements.map((m) => insertOnce(db, 'stock_movements', m)),
        ...(r.ledger ? [insertOnce(db, 'event_ledger', r.ledger)] : []),
      ];
    }
    case 'reservation_request.created':
      return []; // bulutta oluşur, yerelden gelmez
    default:
      throw new Error(`Bilinmeyen olay türü: ${(e as SyncEvent).type}`);
  }
}
