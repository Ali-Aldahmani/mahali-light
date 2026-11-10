const { query, withTransaction } = require('../db/postgres');
const { todayStoreDate } = require('../utils/dates');
const journalService = require('./journalService');
const { logActivity } = require('../utils/activityLog');

// Weighted average inventory valuation (approved 10 Nov 2026, migration 061).
//
// Book value lives on each variant (inventory_value); every stock movement
// records its value_change and every inventory journal line posts exactly
// that, so the sum of book values equals ledger account 1004. This module
// books the one-time correction when the policy starts and checks the
// reconciliation on demand.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const START = 'weighted_average_start';

async function ledgerInventory(client, asOf = null) {
  const { rows: [r] } = await (client || { query }).query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::numeric AS balance
       FROM journal_lines jl
       JOIN chart_of_accounts a ON a.id = jl.account_id AND a.code = '1004'
       JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE $1::date IS NULL OR je.date <= $1::date`,
    [asOf],
  );
  return money(r.balance);
}

async function bookValue(client) {
  const { rows: [r] } = await (client || { query }).query(
    `SELECT COALESCE(SUM(inventory_value), 0)::numeric AS value FROM product_variants`,
  );
  return money(r.value);
}

/**
 * Books the gap between ledger 1004 and the book value once, against
 * retained earnings (3002), as a correction of earlier periods. Nothing
 * historical is rewritten: it is one dated, described entry. Safe to call on
 * every start; it does nothing once recorded. Returns the correction row.
 */
async function ensureOpeningCorrection({ userId = null } = {}) {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('inventory_valuation_start', 0))`);
    const { rows: done } = await client.query(`SELECT * FROM inventory_valuation_corrections WHERE kind = $1`, [START]);
    if (done.length) return done[0];
    const ledger = await ledgerInventory(client);
    const book = await bookValue(client);
    const difference = money(book - ledger);
    let entryId = null;
    if (difference !== 0) {
      const date = todayStoreDate();
      await journalService.ensurePeriodsForDate(date, client);
      const inv = await journalService.getAccountIdByCode('1004', client);
      const retained = await journalService.getAccountIdByCode('3002', client);
      const entry = await journalService.postJournalEntryWith(client, {
        referenceType: 'inventory_valuation',
        referenceId: null,
        date,
        description: `Inventory valuation correction on adopting weighted average cost (ledger ${ledger.toFixed(2)}, book value ${book.toFixed(2)})`,
        userId,
        lines: difference > 0
          ? [{ accountId: inv, debit: difference, credit: 0 }, { accountId: retained, debit: 0, credit: difference }]
          : [{ accountId: retained, debit: -difference, credit: 0 }, { accountId: inv, debit: 0, credit: -difference }],
      });
      entryId = entry?.entry?.id || entry?.id || null;
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO inventory_valuation_corrections (kind, ledger_before, book_value, difference, journal_entry_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [START, ledger, book, difference, entryId],
    );
    await logActivity({
      client, entityType: 'inventory_valuation', action: 'inventory_valuation.policy_started', performedBy: userId,
      newValue: { policy: 'weighted_average', ledgerBefore: ledger, bookValue: book, difference },
    });
    return row;
  });
}

/**
 * The reconciliation, now: ledger 1004 against the book value, the physical
 * cost of the batches for comparison, and every quantity invariant. Each check
 * lists up to 50 offending rows.
 */
async function getReconciliation() {
  const [ledger, book] = await Promise.all([ledgerInventory(null), bookValue(null)]);
  const { rows: [phys] } = await query(
    `SELECT COALESCE(SUM((qty_on_hand + qty_quarantined) * unit_cost), 0)::numeric AS value FROM inventory_batches`,
  );
  const { rows: [start] } = await query(`SELECT * FROM inventory_valuation_corrections WHERE kind = $1`, [START]);

  const checks = [
    {
      key: 'stock_vs_batches',
      label: 'Stock and quarantine equal their cost batches',
      sql: `SELECT v.id AS variant_id, v.sku, v.stock_qty::float8 AS expected, COALESCE(b.on_hand, 0)::float8 AS actual,
                   v.quarantine_qty::float8 AS expected_held, COALESCE(b.held, 0)::float8 AS actual_held
              FROM product_variants v
              LEFT JOIN (SELECT variant_id, SUM(qty_on_hand) AS on_hand, SUM(qty_quarantined) AS held
                           FROM inventory_batches GROUP BY variant_id) b ON b.variant_id = v.id
             WHERE COALESCE(b.on_hand, 0) <> COALESCE(v.stock_qty, 0)
                OR COALESCE(b.held, 0) <> COALESCE(v.quarantine_qty, 0)`,
    },
    {
      key: 'batches_vs_receipts',
      label: 'Each cost batch equals its receipts',
      sql: `SELECT b.id AS batch_id, b.batch_number, b.qty_on_hand::float8 AS expected, COALESCE(r.on_hand, 0)::float8 AS actual
              FROM inventory_batches b
              LEFT JOIN (SELECT batch_id, SUM(qty_on_hand) AS on_hand, SUM(qty_quarantined) AS held
                           FROM inventory_batch_receipts GROUP BY batch_id) r ON r.batch_id = b.id
             WHERE COALESCE(r.on_hand, 0) <> b.qty_on_hand OR COALESCE(r.held, 0) <> b.qty_quarantined`,
    },
    {
      key: 'receipt_arithmetic',
      label: 'Each receipt: remaining = received - sold + returned - other out',
      sql: `SELECT id AS receipt_id, (quantity - qty_sold + qty_returned - qty_out_other)::float8 AS expected,
                   (qty_on_hand + qty_quarantined)::float8 AS actual
              FROM inventory_batch_receipts
             WHERE qty_on_hand + qty_quarantined <> quantity - qty_sold + qty_returned - qty_out_other`,
    },
    {
      key: 'empty_with_value',
      label: 'No book value left on variants without stock',
      sql: `SELECT id AS variant_id, sku, inventory_value::float8 AS actual FROM product_variants
             WHERE COALESCE(stock_qty, 0) + COALESCE(quarantine_qty, 0) = 0 AND inventory_value <> 0`,
    },
    {
      key: 'negative_value',
      label: 'No negative book value',
      sql: `SELECT id AS variant_id, sku, inventory_value::float8 AS actual FROM product_variants WHERE inventory_value < 0`,
    },
  ];
  const results = [];
  for (const c of checks) {
    const { rows } = await query(`${c.sql} LIMIT 50`);
    results.push({ key: c.key, label: c.label, ok: rows.length === 0, issues: rows });
  }
  const difference = money(ledger - book);
  return {
    policy: 'weighted_average',
    policyStartedAt: start?.created_at || null,
    openingCorrection: start ? {
      ledgerBefore: Number(start.ledger_before), bookValue: Number(start.book_value),
      difference: Number(start.difference), journalEntryId: start.journal_entry_id,
    } : null,
    ledgerInventory: ledger,
    bookValue: book,
    difference,
    reconciled: difference === 0 && results.every((r) => r.ok),
    // What the stock was physically bought at, per cost batch. It differs from
    // the book value by design: the books use the weighted average.
    physicalBatchCost: money(phys.value),
    checks: results,
  };
}

module.exports = { ensureOpeningCorrection, getReconciliation, ledgerInventory, bookValue };
