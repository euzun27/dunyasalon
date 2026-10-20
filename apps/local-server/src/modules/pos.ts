import { computeSaleTotals, validatePayments, type PricedLine } from '@dunyatek/business-rules';
import {
  newId,
  nowIso,
  ConflictError,
  NotFoundError,
  ValidationError,
  optionalString,
  requireInt,
  type SaleInput,
} from '@dunyatek/shared';
import { all, one, run, tx, type DB } from '../database/db.ts';
import { audit, enqueue } from '../database/outbox.ts';
import { applyMovement, type MovementRow } from './inventory.ts';
import { postLedgerEntry, type LedgerRow } from './event-accounts.ts';

export interface SaleRow {
  id: string;
  receipt_no: number;
  terminal: string;
  cash_session_id: string | null;
  event_account_id: string | null;
  subtotal_kurus: number;
  discount_kurus: number;
  total_kurus: number;
  vat_kurus: number;
  status: 'tamamlandi' | 'iade';
  note: string | null;
  user_id: string | null;
  created_at: string;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_price_kurus: number;
  vat_rate: number;
  line_total_kurus: number;
}

export interface PaymentRow {
  id: string;
  sale_id: string;
  method: 'nakit' | 'kart' | 'dugun_hesabi';
  amount_kurus: number;
  created_at: string;
}

export interface SaleDetail extends SaleRow {
  items: SaleItemRow[];
  payments: PaymentRow[];
  event_account_title?: string | null;
}

export interface SaleContext {
  userId: string | null;
  terminal: string;
}

function resolveLines(db: DB, input: SaleInput): PricedLine[] {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ValidationError('Sepet boş');
  return input.lines.map((l) => {
    const p = l.product_id
      ? one<{ id: string; name: string; price_kurus: number; vat_rate: number; active: number }>(
          db, 'SELECT id, name, price_kurus, vat_rate, active FROM products WHERE id = ?', l.product_id)
      : l.barcode
        ? one<{ id: string; name: string; price_kurus: number; vat_rate: number; active: number }>(
            db, 'SELECT id, name, price_kurus, vat_rate, active FROM products WHERE barcode = ?', String(l.barcode).trim())
        : undefined;
    if (!p || !p.active) throw new NotFoundError(`Ürün bulunamadı: ${l.product_id ?? l.barcode ?? '?'}`);
    // Fiyat her zaman sunucudaki ürün kartından alınır; istemciden gelen fiyata güvenilmez.
    return {
      product_id: p.id,
      name: p.name,
      qty: requireInt(l.qty, `${p.name} miktarı`, { min: 1 }),
      unit_price_kurus: p.price_kurus,
      vat_rate: p.vat_rate,
    };
  });
}

export function getSale(db: DB, id: string): SaleDetail {
  const sale = one<SaleRow & { event_account_title: string | null }>(
    db,
    `SELECT s.*, a.title AS event_account_title FROM pos_sales s
       LEFT JOIN event_accounts a ON a.id = s.event_account_id WHERE s.id = ?`,
    id,
  );
  if (!sale) throw new NotFoundError('Satış bulunamadı');
  return {
    ...sale,
    items: all<SaleItemRow>(db, 'SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY rowid', id),
    payments: all<PaymentRow>(db, 'SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY rowid', id),
  };
}

/**
 * Satışı tamamlar. Satış, kalemler, ödemeler, stok hareketleri, düğün hesabı borcu ve
 * senkronizasyon olayı tek bir SQLite transaction'ında yazılır: ya hepsi ya hiçbiri.
 * input.id istemcide üretildiyse aynı satışın tekrar gönderimi yeni satış oluşturmaz.
 */
export function completeSale(db: DB, input: SaleInput, ctx: SaleContext): SaleDetail & { duplicate: boolean } {
  if (input.id) {
    const existing = one<{ id: string }>(db, 'SELECT id FROM pos_sales WHERE id = ?', input.id);
    if (existing) return { ...getSale(db, existing.id), duplicate: true };
  }
  const discount = input.discount_kurus ?? 0;
  const note = optionalString(input.note, 'Not', 300);
  const eventAccountId = input.event_account_id || null;

  const saleId = tx(db, () => {
    const lines = resolveLines(db, input);
    const totals = computeSaleTotals(lines, discount);
    const payments = Array.isArray(input.payments) ? input.payments : [];
    validatePayments(totals.total_kurus, payments, eventAccountId);

    const onAccount = payments.filter((p) => p.method === 'dugun_hesabi').reduce((s, p) => s + p.amount_kurus, 0);
    if (eventAccountId) {
      const acc = one<{ status: string; credit_limit_kurus: number | null; title: string }>(
        db, 'SELECT status, credit_limit_kurus, title FROM event_accounts WHERE id = ?', eventAccountId);
      if (!acc) throw new NotFoundError('Organizasyon hesabı bulunamadı');
      if (acc.status !== 'acik') throw new ConflictError(`${acc.title} hesabı kapalı`);
      if (acc.credit_limit_kurus !== null && onAccount > 0) {
        const bal = accountBalance(db, eventAccountId);
        if (bal + onAccount > acc.credit_limit_kurus) {
          throw new ConflictError(`${acc.title} hesabının limiti aşılıyor`);
        }
      }
    }

    const id = input.id ?? newId();
    const now = nowIso();
    const receiptNo = (one<{ n: number | null }>(db, 'SELECT MAX(receipt_no) AS n FROM pos_sales')?.n ?? 0) + 1;
    const cashSession = one<{ id: string }>(
      db, 'SELECT id FROM cash_sessions WHERE terminal = ? AND closed_at IS NULL', ctx.terminal);

    const sale: SaleRow = {
      id,
      receipt_no: receiptNo,
      terminal: ctx.terminal,
      cash_session_id: cashSession?.id ?? null,
      event_account_id: eventAccountId,
      subtotal_kurus: totals.subtotal_kurus,
      discount_kurus: totals.discount_kurus,
      total_kurus: totals.total_kurus,
      vat_kurus: totals.vat_kurus,
      status: 'tamamlandi',
      note,
      user_id: ctx.userId,
      created_at: now,
    };
    run(
      db,
      `INSERT INTO pos_sales (id, receipt_no, terminal, cash_session_id, event_account_id, subtotal_kurus, discount_kurus,
                              total_kurus, vat_kurus, status, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sale.id, sale.receipt_no, sale.terminal, sale.cash_session_id, sale.event_account_id, sale.subtotal_kurus,
      sale.discount_kurus, sale.total_kurus, sale.vat_kurus, sale.status, sale.note, sale.user_id, sale.created_at,
    );

    const items: SaleItemRow[] = [];
    const movements: MovementRow[] = [];
    for (const l of totals.lines) {
      const item: SaleItemRow = {
        id: newId(),
        sale_id: id,
        product_id: l.product_id,
        product_name: l.name,
        qty: l.qty,
        unit_price_kurus: l.unit_price_kurus,
        vat_rate: l.vat_rate,
        line_total_kurus: l.line_total_kurus,
      };
      run(
        db,
        `INSERT INTO pos_sale_items (id, sale_id, product_id, product_name, qty, unit_price_kurus, vat_rate, line_total_kurus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        item.id, item.sale_id, item.product_id, item.product_name, item.qty, item.unit_price_kurus, item.vat_rate, item.line_total_kurus,
      );
      items.push(item);
      movements.push(
        applyMovement(db, {
          product_id: l.product_id,
          type: 'satis',
          qty_delta: -l.qty,
          unit_cost_kurus: null,
          ref_type: 'pos_sale',
          ref_id: id,
          note: null,
          user_id: ctx.userId,
          created_at: now,
        }),
      );
    }

    const paymentRows: PaymentRow[] = payments.map((p) => {
      const row: PaymentRow = { id: newId(), sale_id: id, method: p.method, amount_kurus: p.amount_kurus, created_at: now };
      run(db, 'INSERT INTO pos_payments (id, sale_id, method, amount_kurus, created_at) VALUES (?, ?, ?, ?, ?)',
        row.id, row.sale_id, row.method, row.amount_kurus, row.created_at);
      return row;
    });

    let ledger: LedgerRow | null = null;
    if (eventAccountId && onAccount > 0) {
      ledger = postLedgerEntry(db, {
        event_account_id: eventAccountId,
        entry_type: 'borc',
        amount_kurus: onAccount,
        description: `Kantin satışı #${receiptNo}`,
        ref_type: 'pos_sale',
        ref_id: id,
        user_id: ctx.userId,
        created_at: now,
      });
    }

    enqueue(db, 'sale.completed', id, { sale, items, payments: paymentRows, stock_movements: movements, ledger });
    audit(db, ctx.userId, 'pos.sale', 'pos_sale', id, { receipt_no: receiptNo, total: sale.total_kurus });
    return id;
  });
  return { ...getSale(db, saleId), duplicate: false };
}

export function refundSale(db: DB, saleId: string, ctx: SaleContext, reason?: string): SaleDetail {
  tx(db, () => {
    const sale = getSale(db, saleId);
    if (sale.status === 'iade') throw new ConflictError('Bu satış zaten iade edilmiş');
    const now = nowIso();
    run(db, "UPDATE pos_sales SET status = 'iade' WHERE id = ?", saleId);
    const movements = sale.items.map((it) =>
      applyMovement(db, {
        product_id: it.product_id,
        type: 'iade',
        qty_delta: it.qty,
        unit_cost_kurus: null,
        ref_type: 'pos_sale',
        ref_id: saleId,
        note: reason ?? null,
        user_id: ctx.userId,
        created_at: now,
      }),
    );
    const onAccount = sale.payments.filter((p) => p.method === 'dugun_hesabi').reduce((s, p) => s + p.amount_kurus, 0);
    let ledger: LedgerRow | null = null;
    if (sale.event_account_id && onAccount > 0) {
      ledger = postLedgerEntry(db, {
        event_account_id: sale.event_account_id,
        entry_type: 'alacak',
        amount_kurus: onAccount,
        description: `Kantin iadesi #${sale.receipt_no}`,
        ref_type: 'pos_sale_refund',
        ref_id: saleId,
        user_id: ctx.userId,
        created_at: now,
      });
    }
    enqueue(db, 'sale.refunded', saleId, { sale_id: saleId, refunded_at: now, reason: reason ?? null, stock_movements: movements, ledger });
    audit(db, ctx.userId, 'pos.refund', 'pos_sale', saleId, { reason });
  });
  return getSale(db, saleId);
}

export function listSales(db: DB, opts: { date?: string; limit?: number } = {}): SaleRow[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 1000);
  if (opts.date) {
    return all<SaleRow>(db, `SELECT * FROM pos_sales WHERE substr(created_at, 1, 10) = ? ORDER BY receipt_no DESC LIMIT ${limit}`, opts.date);
  }
  return all<SaleRow>(db, `SELECT * FROM pos_sales ORDER BY receipt_no DESC LIMIT ${limit}`);
}

function accountBalance(db: DB, accountId: string): number {
  return (
    one<{ b: number | null }>(
      db,
      "SELECT SUM(CASE entry_type WHEN 'borc' THEN amount_kurus ELSE -amount_kurus END) AS b FROM event_ledger WHERE event_account_id = ?",
      accountId,
    )?.b ?? 0
  );
}

// --- Kasa oturumu ---

export function openCashSession(db: DB, terminal: string, openingCash: number, userId: string) {
  requireInt(openingCash, 'Açılış nakdi', { min: 0 });
  return tx(db, () => {
    const open = one(db, 'SELECT id FROM cash_sessions WHERE terminal = ? AND closed_at IS NULL', terminal);
    if (open) throw new ConflictError('Bu kasada açık bir oturum zaten var');
    const id = newId();
    run(db, 'INSERT INTO cash_sessions (id, terminal, user_id, opening_cash_kurus, opened_at) VALUES (?, ?, ?, ?, ?)',
      id, terminal, userId, openingCash, nowIso());
    audit(db, userId, 'cash.open', 'cash_session', id, { terminal, openingCash });
    return currentCashSession(db, terminal)!;
  });
}

export function currentCashSession(db: DB, terminal: string) {
  const s = one<{ id: string; terminal: string; user_id: string; opening_cash_kurus: number; opened_at: string }>(
    db, 'SELECT * FROM cash_sessions WHERE terminal = ? AND closed_at IS NULL', terminal);
  if (!s) return null;
  return { ...s, ...cashSessionTotals(db, s.id, s.opening_cash_kurus) };
}

function cashSessionTotals(db: DB, sessionId: string, opening: number) {
  const rows = all<{ method: string; total: number }>(
    db,
    `SELECT p.method, SUM(p.amount_kurus) AS total FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id
      WHERE s.cash_session_id = ? AND s.status = 'tamamlandi' GROUP BY p.method`,
    sessionId,
  );
  const by = Object.fromEntries(rows.map((r) => [r.method, r.total])) as Record<string, number>;
  return {
    cash_kurus: by.nakit ?? 0,
    card_kurus: by.kart ?? 0,
    on_account_kurus: by.dugun_hesabi ?? 0,
    expected_cash_kurus: opening + (by.nakit ?? 0),
  };
}

export function closeCashSession(db: DB, terminal: string, countedCash: number, userId: string) {
  requireInt(countedCash, 'Sayılan nakit', { min: 0 });
  return tx(db, () => {
    const s = currentCashSession(db, terminal);
    if (!s) throw new NotFoundError('Açık kasa oturumu yok');
    run(db, 'UPDATE cash_sessions SET closing_cash_kurus = ?, expected_cash_kurus = ?, closed_at = ? WHERE id = ?',
      countedCash, s.expected_cash_kurus, nowIso(), s.id);
    audit(db, userId, 'cash.close', 'cash_session', s.id, { countedCash, expected: s.expected_cash_kurus });
    return { ...s, closing_cash_kurus: countedCash, difference_kurus: countedCash - s.expected_cash_kurus };
  });
}
