const { query } = require('../db/postgres');
const { storeDate } = require('../utils/dates');

function money(n) {
  n = Number(n) || 0;
  // Math.round(n*100)/100 alone mis-rounds values that land exactly on a
  // half-cent boundary due to IEEE-754 float representation (e.g. 2.90*0.05
  // is stored as 0.14499999999999999, rounding down to 0.14 instead of 0.15).
  // A tiny epsilon nudges genuine .xx5 boundaries the right way without
  // affecting any other value.
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

// Postgres DATE columns are parsed by the pg driver as local midnight, so
// converting via toISOString() (UTC) rolls the date back one day for any
// positive UTC offset (e.g. this store's Asia/Dubai, UTC+4). Read the local
// getters instead to avoid the round-trip — same fix as billService.js.
function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) {
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, '0');
    const d = String(input.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(input).slice(0, 10);
}

function pctChange(current, prev) {
  if (prev === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - prev) / Math.abs(prev)) * 1000) / 10; // 1 decimal
}

// =======================================================================
// Helpers
// =======================================================================
// Sum a set of journal lines filtered by account type or code, scoped to
// entries whose date falls inside [from, to].
async function sumLines({ from, to, accountType = null, codes = null, exclude = null }) {
  const parts = [];
  const params = [from, to];
  let i = 3;
  if (accountType) {
    parts.push(`ca.type = $${i++}`);
    params.push(accountType);
  }
  if (codes && codes.length) {
    parts.push(`ca.code = ANY($${i++}::text[])`);
    params.push(codes);
  }
  if (exclude && exclude.length) {
    parts.push(`ca.code <> ALL($${i++}::text[])`);
    params.push(exclude);
  }
  const where = parts.length ? `AND ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS net_credit,
            COALESCE(SUM(jl.debit), 0)::float8 AS total_debit,
            COALESCE(SUM(jl.credit), 0)::float8 AS total_credit
       FROM journal_lines jl
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.date BETWEEN $1::date AND $2::date
        ${where}`,
    params,
  );
  return {
    netCredit: money(rows[0].net_credit),
    totalDebit: money(rows[0].total_debit),
    totalCredit: money(rows[0].total_credit),
  };
}

// Per-account breakdown (for the P&L expense list).
async function breakdownByAccount({ from, to, accountType, excludeCodes = [] }) {
  const { rows } = await query(
    `SELECT ca.code, ca.name, ca.type,
            COALESCE(SUM(jl.debit), 0)::float8 AS debit,
            COALESCE(SUM(jl.credit), 0)::float8 AS credit
       FROM chart_of_accounts ca
       -- Lines and entries join first: filtering the date on a separate LEFT
       -- JOIN kept every line ever posted, so revenue and expenses were
       -- all-time figures whatever period was asked for.
       LEFT JOIN (
         journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
          AND je.date BETWEEN $1::date AND $2::date
       ) ON jl.account_id = ca.id
      WHERE ca.type = $3
        AND ($4::text[] IS NULL OR ca.code <> ALL($4::text[]))
      GROUP BY ca.code, ca.name, ca.type
      ORDER BY ca.code`,
    [from, to, accountType, excludeCodes.length ? excludeCodes : null],
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    debit: money(r.debit),
    credit: money(r.credit),
    // For expense accounts: positive amount = debit - credit. For revenue:
    // positive = credit - debit. Caller decides which to read.
    netDebit: money(Number(r.debit) - Number(r.credit)),
    netCredit: money(Number(r.credit) - Number(r.debit)),
  }));
}

// =======================================================================
// P&L by period bucket, from the ledger
// =======================================================================
// The one classification every profit figure uses (the P&L below, the
// dashboard KPIs, trends and series):
//   revenue  = revenue accounts (credit - debit), header 4000 excluded
//   cogs     = 5001;  card fees = 5017
//   expenses = every other expense account (debit - credit)
//   gross = revenue - cogs; contribution = gross - fees; net = contribution - expenses
const PL_SQL_NET = `SUM(jl.debit - jl.credit)`;
function classifyPL(rows) {
  let revenue = 0; let cogs = 0; let fees = 0; let expenses = 0;
  for (const r of rows) {
    const n = Number(r.net) || 0;
    if (r.type === 'revenue' && r.code !== '4000') revenue -= n;
    else if (r.code === '5001') cogs += n;
    else if (r.code === '5017') fees += n;
    else if (r.type === 'expense' && r.code !== '5000') expenses += n;
  }
  revenue = money(revenue); cogs = money(cogs); fees = money(fees); expenses = money(expenses);
  const grossProfit = money(revenue - cogs);
  const contributionProfit = money(grossProfit - fees);
  return { revenue, cogs, paymentFees: fees, grossProfit, contributionProfit, expenses, netProfit: money(contributionProfit - expenses) };
}

/** P&L totals per day/week/month/year bucket between two dates (inclusive). */
async function getPLSeries({ startDate, endDate, groupBy = 'month' }) {
  const trunc = { day: 'day', week: 'week', month: 'month', year: 'year' }[groupBy] || 'month';
  const from = dateOnly(startDate);
  const to = dateOnly(endDate);
  const { rows } = await query(
    `SELECT to_char(date_trunc('${trunc}', je.date)::date, 'YYYY-MM-DD') AS bucket, ca.code, ca.type,
            ${PL_SQL_NET}::float8 AS net
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
      WHERE je.date BETWEEN $1::date AND $2::date AND ca.type IN ('revenue', 'expense')
      GROUP BY 1, 2, 3`,
    [from, to],
  );
  const { rows: buckets } = await query(
    `SELECT DISTINCT to_char(date_trunc('${trunc}', d)::date, 'YYYY-MM-DD') AS bucket
       FROM generate_series($1::date, $2::date, '1 day'::interval) AS d ORDER BY 1`,
    [from, to],
  );
  const by = new Map(buckets.map((b) => [b.bucket, []]));
  for (const r of rows) (by.get(r.bucket) || by.set(r.bucket, []).get(r.bucket)).push(r);
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, rs]) => ({ bucket, ...classifyPL(rs) }));
}

/** P&L totals for one period, by the same classification. */
async function getPLTotals({ startDate, endDate }) {
  const { rows } = await query(
    `SELECT ca.code, ca.type, ${PL_SQL_NET}::float8 AS net
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
      WHERE je.date BETWEEN $1::date AND $2::date AND ca.type IN ('revenue', 'expense')
      GROUP BY 1, 2`,
    [dateOnly(startDate), dateOnly(endDate)],
  );
  return classifyPL(rows);
}

// =======================================================================
// Profit & Loss
// =======================================================================
async function getProfitAndLoss({ startDate, endDate, compare = false }) {
  const period = await buildPLPeriod(startDate, endDate);
  if (!compare) return period;

  const span =
    Math.floor(
      (new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) /
        (1000 * 60 * 60 * 24),
    ) + 1;
  const prevEnd = new Date(`${startDate}T00:00:00`);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - span + 1);
  const prev = await buildPLPeriod(
    storeDate(prevStart),
    storeDate(prevEnd),
  );
  return {
    ...period,
    previous: prev,
    delta: {
      revenue: pctChange(period.revenue.total, prev.revenue.total),
      cogs: pctChange(period.cogs.total, prev.cogs.total),
      grossProfit: pctChange(period.grossProfit, prev.grossProfit),
      contributionProfit: pctChange(period.contributionProfit, prev.contributionProfit),
      expenses: pctChange(period.expenses.total, prev.expenses.total),
      netProfit: pctChange(period.netProfit, prev.netProfit),
    },
  };
}

async function buildPLPeriod(startDate, endDate) {
  const from = dateOnly(startDate);
  const to = dateOnly(endDate);

  // Revenue accounts (4xxx) — credits boost revenue.
  const revenueBreakdown = await breakdownByAccount({
    from,
    to,
    accountType: 'revenue',
  });
  const revenueLines = revenueBreakdown
    .filter((r) => r.code !== '4000') // skip the top-level header
    .map((r) => ({ code: r.code, name: r.name, amount: r.netCredit }));
  const revenueTotal = money(
    revenueLines.reduce((s, r) => s + r.amount, 0),
  );

  // COGS — code 5001.
  const cogsSum = await sumLines({ from, to, codes: ['5001'] });
  const cogsTotal = money(cogsSum.totalDebit - cogsSum.totalCredit);

  const grossProfit = money(revenueTotal - cogsTotal);
  const grossMargin = revenueTotal > 0
    ? Math.round((grossProfit / revenueTotal) * 1000) / 10
    : 0;

  // Card processing fees (5017) come off gross profit to give contribution
  // profit, before operating expenses.
  const feeSum = await sumLines({ from, to, codes: ['5017'] });
  const paymentFeesTotal = money(feeSum.totalDebit - feeSum.totalCredit);
  const contributionProfit = money(grossProfit - paymentFeesTotal);
  const contributionMargin = revenueTotal > 0
    ? Math.round((contributionProfit / revenueTotal) * 1000) / 10
    : 0;

  // Operating expenses — everything in 5xxx except COGS (5001) and card fees.
  const expenseBreakdown = await breakdownByAccount({
    from,
    to,
    accountType: 'expense',
    excludeCodes: ['5000', '5001', '5017'],
  });
  const expenseLines = expenseBreakdown
    .filter((r) => r.netDebit !== 0)
    .map((r) => ({ code: r.code, name: r.name, amount: r.netDebit }));
  const expenseTotal = money(expenseLines.reduce((s, r) => s + r.amount, 0));

  const netProfit = money(contributionProfit - expenseTotal);
  const netMargin = revenueTotal > 0
    ? Math.round((netProfit / revenueTotal) * 1000) / 10
    : 0;

  return {
    startDate: from,
    endDate: to,
    revenue: { lines: revenueLines, total: revenueTotal },
    cogs: { total: cogsTotal },
    grossProfit,
    grossMargin,
    paymentFees: { total: paymentFeesTotal },
    contributionProfit,
    contributionMargin,
    expenses: { lines: expenseLines, total: expenseTotal },
    netProfit,
    netMargin,
  };
}

// =======================================================================
// Balance Sheet
// =======================================================================
// Balance of a chart-of-accounts code, as of a date, straight from the
// journal — the only way to get a figure that's actually true "as of" a
// past date, since cash_drawer/bank_accounts/customers/product_variants/
// purchase_orders only ever hold the CURRENT live balance with no history.
// `normal` is 'debit' for asset accounts (cash/bank/AR/inventory) or
// 'credit' for liability accounts (AP/VAT payable) — it picks which side
// of debit-credit represents a positive balance for that account type.
async function accountBalanceAsOf(code, asOf, normal = 'debit') {
  const { rows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS bal
       FROM journal_lines jl
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE ca.code = $1
        AND je.date <= $2::date`,
    [code, asOf],
  );
  const bal = Number(rows[0]?.bal || 0);
  return money(normal === 'credit' ? -bal : bal);
}

// Every account's debit and credit totals from the ledger, up to `asOf`
// (and from `from`, when given).
async function accountTotals(asOf, from = null) {
  const { rows } = await query(
    `SELECT ca.code, ca.name, ca.type,
            COALESCE(SUM(jl.debit), 0)::float8 AS debit,
            COALESCE(SUM(jl.credit), 0)::float8 AS credit
       FROM chart_of_accounts ca
       LEFT JOIN (
         journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
          AND je.date <= $1::date
          AND ($2::date IS NULL OR je.date >= $2::date)
       ) ON jl.account_id = ca.id
      GROUP BY ca.code, ca.name, ca.type
      ORDER BY ca.code`,
    [asOf, from],
  );
  return rows.map((r) => ({ ...r, debit: money(r.debit), credit: money(r.credit) }));
}

const HEADER_CODES = new Set(['1000', '2000', '3000', '4000', '5000']);

/**
 * Trial balance: every account with activity, its debit and credit totals and
 * its balance on the side it falls. Debits must equal credits.
 */
async function getTrialBalance({ asOfDate, startDate = null, includeZero = false }) {
  const asOf = dateOnly(asOfDate) || storeDate();
  const from = dateOnly(startDate);
  const rows = await accountTotals(asOf, from);
  const accounts = rows
    .filter((r) => includeZero || r.debit !== 0 || r.credit !== 0)
    .map((r) => {
      const net = money(r.debit - r.credit);
      return {
        code: r.code, name: r.name, type: r.type,
        debit: r.debit, credit: r.credit,
        balanceDebit: net > 0 ? net : 0,
        balanceCredit: net < 0 ? -net : 0,
      };
    });
  const totals = {
    debit: money(accounts.reduce((s, a) => s + a.debit, 0)),
    credit: money(accounts.reduce((s, a) => s + a.credit, 0)),
    balanceDebit: money(accounts.reduce((s, a) => s + a.balanceDebit, 0)),
    balanceCredit: money(accounts.reduce((s, a) => s + a.balanceCredit, 0)),
  };
  const difference = money(totals.debit - totals.credit);
  return { asOfDate: asOf, startDate: from, accounts, totals, difference, balanced: difference === 0 };
}

// The first day of the fiscal year containing `asOf`.
async function fiscalYearStart(asOf) {
  const { rows: [s] } = await query(`SELECT fiscal_year_start_month FROM app_settings ORDER BY updated_at DESC LIMIT 1`);
  const startMonth = Math.min(12, Math.max(1, Number(s?.fiscal_year_start_month) || 1));
  const [y, m] = asOf.split('-').map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

/**
 * Balance sheet from every ledger account, nothing assumed: assets,
 * liabilities, equity accounts, and the earnings not yet closed to equity
 * (before this fiscal year, and this fiscal year to date). Assets must equal
 * liabilities plus equity; a difference is reported, never absorbed.
 */
async function getBalanceSheet({ asOfDate }) {
  const asOf = dateOnly(asOfDate);
  const yearStart = await fiscalYearStart(asOf);
  const all = await accountTotals(asOf);
  const thisYear = await accountTotals(asOf, yearStart);
  const net = (r) => money(r.debit - r.credit);
  const lines = (type, sign) => all
    .filter((r) => r.type === type && !HEADER_CODES.has(r.code) && (r.debit !== 0 || r.credit !== 0))
    .map((r) => ({ code: r.code, name: r.name, amount: money(sign * net(r)) }));
  const earningsOf = (rows) => money(-rows
    .filter((r) => r.type === 'revenue' || r.type === 'expense')
    .reduce((s, r) => s + net(r), 0));
  const assetLines = lines('asset', 1);
  const liabilityLines = lines('liability', -1);
  const equityLines = lines('equity', -1);
  const totalEarnings = earningsOf(all);
  const currentYearEarnings = earningsOf(thisYear);
  const priorEarnings = money(totalEarnings - currentYearEarnings);
  const byCode = (code, sign) => money(sign * net(all.find((r) => r.code === code) || { debit: 0, credit: 0 }));

  // Per-bank breakdown is live balances only (journal posts to one 1002
  // account), shown for reference; the totals use the ledger.
  const { rows: bankRows } = await query(
    `SELECT id, account_name, bank_name, current_balance FROM bank_accounts WHERE is_active = true ORDER BY account_name`,
  );
  const banks = bankRows.map((r) => ({ id: r.id, label: `${r.bank_name} – ${r.account_name}`, balance: money(r.current_balance) }));

  const totalAssets = money(assetLines.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = money(liabilityLines.reduce((s, l) => s + l.amount, 0));
  const equityAccounts = money(equityLines.reduce((s, l) => s + l.amount, 0));
  const totalEquity = money(equityAccounts + totalEarnings);
  const difference = money(totalAssets - totalLiabilities - totalEquity);
  return {
    asOfDate: asOf,
    fiscalYearStart: yearStart,
    assets: {
      lines: assetLines,
      cash: byCode('1001', 1),
      banks,
      banksTotal: byCode('1002', 1),
      receivables: byCode('1003', 1),
      inventory: byCode('1004', 1),
      total: totalAssets,
    },
    liabilities: {
      lines: liabilityLines,
      payables: byCode('2001', -1),
      vatPayable: byCode('2002', -1),
      total: totalLiabilities,
    },
    equity: {
      lines: equityLines,
      priorEarnings,
      currentYearEarnings,
      total: totalEquity,
      // Kept for older screens: now the real equity, not assets - liabilities.
      netEquity: totalEquity,
    },
    difference,
    balanced: difference === 0,
  };
}

// =======================================================================
// Cash Flow Statement
// =======================================================================
async function getCashFlowStatement({ startDate, endDate }) {
  const from = dateOnly(startDate);
  const to = dateOnly(endDate);

  // Cash movements from cash_drawer_transactions + bank_transactions tables.
  // Normalize the bank-side "manual_deposit/manual_withdrawal" labels onto
  // the cash-side "manual_in/manual_out" buckets so the financing section
  // stays consistent regardless of source.
  const { rows: cashTx } = await query(
    `SELECT transaction_type, direction,
            COALESCE(SUM(amount), 0)::float8 AS total
       FROM cash_drawer_transactions
      WHERE timestamp::date BETWEEN $1::date AND $2::date
      GROUP BY transaction_type, direction`,
    [from, to],
  );
  const { rows: bankTx } = await query(
    `SELECT CASE
              WHEN transaction_type = 'manual_deposit'    THEN 'manual_in'
              WHEN transaction_type = 'manual_withdrawal' THEN 'manual_out'
              ELSE transaction_type
            END AS transaction_type,
            direction,
            COALESCE(SUM(amount), 0)::float8 AS total
       FROM bank_transactions
      WHERE timestamp::date BETWEEN $1::date AND $2::date
      GROUP BY 1, direction`,
    [from, to],
  );
  const all = [...cashTx, ...bankTx];

  // Sum helper: returns net (in - out) for a transaction_type.
  function net(type) {
    return all
      .filter((r) => r.transaction_type === type)
      .reduce((s, r) => {
        const amt = Number(r.total) || 0;
        return r.direction === 'in' ? s + amt : s - amt;
      }, 0);
  }

  const cashFromSales = money(net('sale'));
  const cashFromCollections = money(net('customer_payment'));
  const paidToSuppliers = money(-net('supplier_payment'));
  const billsPaid = money(-net('bill_payment'));
  const expensesPaid = money(-net('expense'));
  const refundsPaid = money(-net('refund'));

  const netOperating = money(
    cashFromSales +
      cashFromCollections -
      paidToSuppliers -
      billsPaid -
      expensesPaid -
      refundsPaid,
  );

  // Financing: manual_in / manual_out + transfer (treated neutral for net).
  const manualDeposits = money(net('manual_in'));
  const manualWithdrawals = money(-net('manual_out'));
  const netFinancing = money(manualDeposits - manualWithdrawals);

  const netCashChange = money(netOperating + netFinancing);

  // Opening balance: cash + banks before "from" date. We use journal lines on
  // the asset cash/bank accounts as a proxy (DB-side authority).
  const { rows: openRows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS bal
       FROM journal_lines jl
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE ca.code IN ('1001','1002')
        AND je.date < $1::date`,
    [from],
  );
  const openingCash = money(openRows[0].bal || 0);
  const closingCash = money(openingCash + netCashChange);

  return {
    startDate: from,
    endDate: to,
    operating: {
      cashFromSales,
      cashFromCollections,
      paidToSuppliers,
      billsPaid,
      expensesPaid,
      refundsPaid,
      net: netOperating,
    },
    financing: {
      manualDeposits,
      manualWithdrawals,
      net: netFinancing,
    },
    netCashChange,
    openingCash,
    closingCash,
  };
}

// =======================================================================
// VAT Report (UAE FTA format)
// =======================================================================
async function getVATReport({ startDate, endDate }) {
  const from = dateOnly(startDate);
  const to = dateOnly(endDate);

  // Output tax: sum of invoice tax_amount on confirmed invoices in period,
  // net of customer refunds/replacements in the same period — otherwise a
  // fully refunded sale kept showing VAT due on a sale that no longer
  // exists. total_value is tax-inclusive while taxable_amount/tax_amount
  // are tax-exclusive/tax-only, so de-tax using each return's original
  // invoice's own rate before netting (mirrors the same fix in
  // analyticsService.js's getKPIs).
  const { rows: outRows } = await query(
    // Decision (review 5 Nov): a sale counts in the period it was confirmed,
    // even if it is cancelled later, and the cancellation is subtracted in the
    // period it happened. Dropping cancelled sales rewrote periods that may
    // already have been filed, and the later period showed no adjustment.
    `WITH sales AS (
       SELECT COALESCE(SUM(taxable_amount), 0)::float8 AS net_sales,
              COALESCE(SUM(tax_amount),     0)::float8 AS output_tax
         FROM invoices
        WHERE status IN ('confirmed', 'cancelled')
          AND confirmed_at IS NOT NULL
          AND confirmed_at::date BETWEEN $1::date AND $2::date
     ),
     cancels AS (
       SELECT COALESCE(SUM(taxable_amount), 0)::float8 AS net_sales,
              COALESCE(SUM(tax_amount),     0)::float8 AS output_tax
         FROM invoices
        WHERE status = 'cancelled'
          AND confirmed_at IS NOT NULL
          AND cancelled_at::date BETWEEN $1::date AND $2::date
     ),
     returns AS (
       SELECT COALESCE(SUM(
                CASE WHEN i.tax_rate > 0 THEN ro.total_value / (1 + i.tax_rate / 100)
                     ELSE ro.total_value END
              ), 0)::float8 AS net_returns,
              COALESCE(SUM(
                CASE WHEN i.tax_rate > 0
                     THEN ro.total_value - (ro.total_value / (1 + i.tax_rate / 100))
                     ELSE 0 END
              ), 0)::float8 AS tax_reversed
         FROM return_orders ro
         LEFT JOIN invoices i ON i.id = ro.original_invoice_id
        WHERE ro.return_type IN ('customer_refund', 'customer_replace')
          AND ro.created_at::date BETWEEN $1::date AND $2::date
     )
     SELECT sales.net_sales - cancels.net_sales - returns.net_returns AS net_sales,
            sales.output_tax - cancels.output_tax - returns.tax_reversed AS output_tax
       FROM sales, cancels, returns`,
    [from, to],
  );
  const netSales = money(outRows[0].net_sales || 0);
  const outputTax = money(outRows[0].output_tax || 0);

  // Input tax and net purchases straight from the ledger: PO receipts
  // (DR inventory + DR input VAT on 2002) net of goods returned to
  // suppliers, dated when goods arrived / went back. This used to read
  // purchase_orders.vat_amount, which nothing wrote, so input tax was
  // always 0 and VAT payable was overstated by every purchase's VAT.
  const { rows: inRows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.code = '1004'), 0)::float8 AS net_purchases,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.code = '2002'), 0)::float8 AS input_tax
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN chart_of_accounts a ON a.id = jl.account_id
      WHERE je.date BETWEEN $1::date AND $2::date
        AND (je.reference_type = 'purchase_order'
             OR (je.reference_type = 'return_order' AND EXISTS (
                   SELECT 1 FROM return_orders ro
                    WHERE ro.id = je.reference_id AND ro.return_type = 'supplier_return')))`,
    [from, to],
  );
  const netPurchases = money(inRows[0].net_purchases || 0);
  const inputTax = money(inRows[0].input_tax || 0);

  const netPayable = money(outputTax - inputTax);

  // Due date: 28 days after the period end (UAE FTA quarterly cycle).
  const endD = new Date(`${to}T00:00:00`);
  endD.setDate(endD.getDate() + 28);
  const dueDate = storeDate(endD);

  return {
    startDate: from,
    endDate: to,
    netSales,
    outputTax,
    netPurchases,
    inputTax,
    netPayable,
    dueDate,
  };
}

// =======================================================================
// Dashboard widget snapshot
// =======================================================================
async function getDashboardSnapshot() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const prevStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const prevEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const pl = await buildPLPeriod(monthStart, monthEnd);
  const prevPL = await buildPLPeriod(prevStart, prevEnd);

  // Pull current cash + banks + AR + AP + VAT for the snapshot tiles.
  const bs = await getBalanceSheet({ asOfDate: monthEnd });

  // VAT due date: end of current quarter + 28 days.
  const quarter = Math.floor(month / 3);
  const qEnd = new Date(Date.UTC(year, quarter * 3 + 3, 0));
  qEnd.setUTCDate(qEnd.getUTCDate() + 28);
  const vatDueDate = qEnd.toISOString().slice(0, 10);
  const vatDaysLeft = Math.max(
    0,
    Math.floor((qEnd - new Date()) / (1000 * 60 * 60 * 24)),
  );

  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    revenue: { mtd: pl.revenue.total, prev: prevPL.revenue.total,
      delta: pctChange(pl.revenue.total, prevPL.revenue.total) },
    expenses: { mtd: money(pl.cogs.total + pl.paymentFees.total + pl.expenses.total),
      prev: money(prevPL.cogs.total + prevPL.paymentFees.total + prevPL.expenses.total),
      delta: pctChange(
        pl.cogs.total + pl.paymentFees.total + pl.expenses.total,
        prevPL.cogs.total + prevPL.paymentFees.total + prevPL.expenses.total,
      ) },
    netProfit: { mtd: pl.netProfit, prev: prevPL.netProfit,
      delta: pctChange(pl.netProfit, prevPL.netProfit) },
    cash: bs.assets.cash + bs.assets.banksTotal,
    receivables: bs.assets.receivables,
    payables: bs.liabilities.payables,
    vatPayable: bs.liabilities.vatPayable,
    vatDueDate,
    vatDaysLeft,
  };
}

module.exports = {
  getProfitAndLoss,
  getPLSeries,
  getPLTotals,
  getBalanceSheet,
  getTrialBalance,
  getCashFlowStatement,
  getVATReport,
  getDashboardSnapshot,
};
