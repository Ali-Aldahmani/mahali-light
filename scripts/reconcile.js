#!/usr/bin/env node
'use strict';

/**
 * Read-only reconciliation report.
 *
 * Compares every running balance the app keeps against the records it was
 * built from, so a fix can be checked by running this before and after:
 * any new difference means stop and investigate.
 *
 *   usage: node scripts/reconcile.js [--json] [--strict]
 *
 * Connects with the usual PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 * (or DATABASE_URL). Everything runs inside a READ ONLY transaction, so the
 * script cannot change data even by mistake.
 *
 * Exit code is 0 unless --strict is given and a check found differences.
 * A difference is a lead to explain, not proof of a bug: manual SQL edits,
 * older app versions or opening balances can all leave one behind.
 */

const { Pool } = require('pg');

const CHECKS = [
  {
    id: 'drawer_vs_ledger',
    title: 'Cash drawer balance vs its last ledger row',
    sql: `
      SELECT d.name AS item,
             d.current_balance::float8 AS recorded,
             t.balance_after::float8 AS expected
        FROM cash_drawer d
        LEFT JOIN LATERAL (
          SELECT balance_after FROM cash_drawer_transactions
           WHERE cash_drawer_id = d.id ORDER BY timestamp DESC, id DESC LIMIT 1
        ) t ON TRUE
       WHERE t.balance_after IS NOT NULL
         AND ABS(d.current_balance - t.balance_after) > 0.005`,
  },
  {
    id: 'drawer_chain',
    title: 'Cash ledger rows whose opening balance skips from the previous row',
    // Opening rows always start from 0 by convention; drawer_reopen covers them.
    sql: `
      SELECT to_char(timestamp, 'YYYY-MM-DD HH24:MI') || ' ' || transaction_type AS item,
             balance_before::float8 AS recorded,
             prev_after::float8 AS expected
        FROM (
          SELECT *, LAG(balance_after) OVER (PARTITION BY cash_drawer_id ORDER BY timestamp, id) AS prev_after
            FROM cash_drawer_transactions
        ) x
       WHERE transaction_type <> 'opening'
         AND prev_after IS NOT NULL AND ABS(balance_before - prev_after) > 0.005`,
  },
  {
    id: 'drawer_reopen',
    title: 'Drawer reopened with a different amount than it closed with (cash moved with no record)',
    sql: `
      SELECT to_char(timestamp, 'YYYY-MM-DD HH24:MI') || ' opening' AS item,
             balance_after::float8 AS recorded,
             prev_after::float8 AS expected
        FROM (
          SELECT *, LAG(balance_after) OVER (PARTITION BY cash_drawer_id ORDER BY timestamp, id) AS prev_after
            FROM cash_drawer_transactions
        ) x
       WHERE transaction_type = 'opening'
         AND prev_after IS NOT NULL AND ABS(balance_after - prev_after) > 0.005`,
  },
  {
    id: 'drawer_arithmetic',
    title: 'Cash ledger rows where before ± amount ≠ after',
    sql: `
      SELECT to_char(timestamp, 'YYYY-MM-DD HH24:MI') || ' ' || transaction_type AS item,
             balance_after::float8 AS recorded,
             (balance_before + CASE WHEN direction = 'in' THEN amount ELSE -amount END)::float8 AS expected
        FROM cash_drawer_transactions
       WHERE transaction_type NOT IN ('opening', 'closing')
         AND ABS(balance_after - (balance_before + CASE WHEN direction = 'in' THEN amount ELSE -amount END)) > 0.005`,
  },
  {
    id: 'bank_vs_ledger',
    title: 'Bank account balance vs its last ledger row',
    sql: `
      SELECT b.bank_name || ' ' || COALESCE(b.account_number, '') AS item,
             b.current_balance::float8 AS recorded,
             t.balance_after::float8 AS expected
        FROM bank_accounts b
        LEFT JOIN LATERAL (
          SELECT balance_after FROM bank_transactions
           WHERE bank_account_id = b.id ORDER BY timestamp DESC, id DESC LIMIT 1
        ) t ON TRUE
       WHERE t.balance_after IS NOT NULL
         AND ABS(b.current_balance - t.balance_after) > 0.005`,
  },
  {
    id: 'customer_balance',
    title: 'Customer balance vs credit sales − collections − credit refunds',
    sql: `
      WITH credit_sales AS (
        SELECT i.customer_id, SUM(p.amount) AS amt
          FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE p.method = 'credit' AND i.status NOT IN ('draft', 'cancelled')
         GROUP BY 1
      ), collections AS (
        SELECT customer_id, SUM(amount) AS amt FROM customer_payments GROUP BY 1
      ), credit_refunds AS (
        SELECT o.customer_id, SUM(r.amount) AS amt
          FROM refund_payments r JOIN return_orders o ON o.id = r.return_order_id
         WHERE r.method = 'credit' AND o.customer_id IS NOT NULL
         GROUP BY 1
      )
      SELECT c.name AS item,
             c.credit_balance::float8 AS recorded,
             (COALESCE(s.amt, 0) - COALESCE(k.amt, 0) - COALESCE(r.amt, 0))::float8 AS expected
        FROM customers c
        LEFT JOIN credit_sales s ON s.customer_id = c.id
        LEFT JOIN collections k ON k.customer_id = c.id
        LEFT JOIN credit_refunds r ON r.customer_id = c.id
       WHERE ABS(c.credit_balance - (COALESCE(s.amt, 0) - COALESCE(k.amt, 0) - COALESCE(r.amt, 0))) > 0.005`,
  },
  {
    id: 'invoice_paid',
    title: 'Invoice amount paid vs its payment rows',
    sql: `
      SELECT i.invoice_number AS item,
             i.amount_paid::float8 AS recorded,
             COALESCE(SUM(p.amount), 0)::float8 AS expected
        FROM invoices i LEFT JOIN invoice_payments p ON p.invoice_id = i.id
       WHERE i.status <> 'cancelled'
       GROUP BY i.id
      HAVING ABS(i.amount_paid - COALESCE(SUM(p.amount), 0)) > 0.005`,
  },
  {
    id: 'po_paid',
    title: 'Purchase order amount paid vs its supplier payments',
    sql: `
      SELECT po.po_number AS item,
             po.amount_paid::float8 AS recorded,
             COALESCE(SUM(sp.amount), 0)::float8 AS expected
        FROM purchase_orders po LEFT JOIN supplier_payments sp ON sp.purchase_order_id = po.id
       GROUP BY po.id
      HAVING ABS(po.amount_paid - COALESCE(SUM(sp.amount), 0)) > 0.005`,
  },
  {
    id: 'po_balance',
    title: 'Purchase order balance due vs total − paid',
    sql: `
      SELECT po_number AS item,
             balance_due::float8 AS recorded,
             (total_cost - amount_paid)::float8 AS expected
        FROM purchase_orders
       WHERE status <> 'cancelled' AND ABS(balance_due - (total_cost - amount_paid)) > 0.005`,
  },
  {
    id: 'stock_vs_movements',
    title: 'Variant stock vs its last stock movement',
    sql: `
      SELECT v.sku AS item,
             v.stock_qty::float8 AS recorded,
             m.qty_after::float8 AS expected
        FROM product_variants v
        JOIN LATERAL (
          SELECT qty_after FROM stock_movements
           WHERE variant_id = v.id ORDER BY timestamp DESC, id DESC LIMIT 1
        ) m ON TRUE
       WHERE ABS(v.stock_qty - m.qty_after) > 0.005`,
  },
  {
    id: 'stock_chain',
    title: 'Stock movements whose opening quantity skips from the previous movement',
    sql: `
      SELECT sku || ' ' || to_char(timestamp, 'YYYY-MM-DD HH24:MI') || ' ' || movement_type AS item,
             qty_before::float8 AS recorded,
             prev_after::float8 AS expected
        FROM (
          SELECT m.*, v.sku,
                 LAG(m.qty_after) OVER (PARTITION BY m.variant_id ORDER BY m.timestamp, m.id) AS prev_after
            FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id
        ) x
       WHERE prev_after IS NOT NULL AND ABS(qty_before - prev_after) > 0.005`,
  },
  {
    id: 'journal_balanced',
    title: 'Journal entries whose debits ≠ credits',
    sql: `
      SELECT e.entry_number AS item,
             SUM(l.debit)::float8 AS recorded,
             SUM(l.credit)::float8 AS expected
        FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
       GROUP BY e.id
      HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.005`,
  },
  {
    id: 'gl_cash_vs_drawer',
    title: 'General-ledger cash (1001) vs cash drawer balance',
    sql: `
      SELECT 'Cash 1001' AS item,
             COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l
                        JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '1001'), 0)::float8 AS recorded,
             COALESCE((SELECT SUM(current_balance) FROM cash_drawer), 0)::float8 AS expected
      WHERE ABS(COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l
                           JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '1001'), 0)
                - COALESCE((SELECT SUM(current_balance) FROM cash_drawer), 0)) > 0.005`,
  },
  {
    id: 'gl_bank_vs_accounts',
    title: 'General-ledger bank (1002) vs bank account balances',
    sql: `
      SELECT 'Bank 1002' AS item,
             COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l
                        JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '1002'), 0)::float8 AS recorded,
             COALESCE((SELECT SUM(current_balance) FROM bank_accounts), 0)::float8 AS expected
      WHERE ABS(COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l
                           JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '1002'), 0)
                - COALESCE((SELECT SUM(current_balance) FROM bank_accounts), 0)) > 0.005`,
  },
];

async function runChecks(client) {
  const results = [];
  for (const check of CHECKS) {
    try {
      const { rows } = await client.query(check.sql);
      results.push({ id: check.id, title: check.title, differences: rows });
    } catch (err) {
      results.push({ id: check.id, title: check.title, error: err.message });
    }
  }
  return results;
}

async function reconcile(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    return await runChecks(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

function fmt(n) {
  return n == null ? '—' : Number(n).toFixed(2);
}

function printReport(results) {
  let total = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`!  ${r.title}\n     could not run: ${r.error}`);
      continue;
    }
    total += r.differences.length;
    console.log(`${r.differences.length ? '✗' : '✓'}  ${r.title}${r.differences.length ? ` — ${r.differences.length}` : ''}`);
    for (const d of r.differences.slice(0, 20)) {
      const gap = d.recorded != null && d.expected != null ? Number(d.recorded) - Number(d.expected) : null;
      console.log(`     ${String(d.item).padEnd(38)} recorded ${fmt(d.recorded).padStart(12)}  expected ${fmt(d.expected).padStart(12)}  gap ${fmt(gap)}`);
    }
    if (r.differences.length > 20) console.log(`     … and ${r.differences.length - 20} more`);
  }
  console.log(`\n${total} difference(s) across ${results.length} checks.`);
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  try {
    const results = await reconcile(pool);
    const found = results.some((r) => r.error || r.differences.length);
    if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
    else printReport(results);
    return args.includes('--strict') && found ? 2 : 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`reconcile failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { CHECKS, reconcile };
