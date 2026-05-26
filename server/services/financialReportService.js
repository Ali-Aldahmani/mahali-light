const { query } = require('../db/postgres');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
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
       LEFT JOIN journal_lines jl ON jl.account_id = ca.id
       LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
        AND je.date BETWEEN $1::date AND $2::date
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
    prevStart.toISOString().slice(0, 10),
    prevEnd.toISOString().slice(0, 10),
  );
  return {
    ...period,
    previous: prev,
    delta: {
      revenue: pctChange(period.revenue.total, prev.revenue.total),
      cogs: pctChange(period.cogs.total, prev.cogs.total),
      grossProfit: pctChange(period.grossProfit, prev.grossProfit),
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

  // Operating expenses — everything in 5xxx except COGS (5001).
  const expenseBreakdown = await breakdownByAccount({
    from,
    to,
    accountType: 'expense',
    excludeCodes: ['5000', '5001'],
  });
  const expenseLines = expenseBreakdown
    .filter((r) => r.netDebit !== 0)
    .map((r) => ({ code: r.code, name: r.name, amount: r.netDebit }));
  const expenseTotal = money(expenseLines.reduce((s, r) => s + r.amount, 0));

  const netProfit = money(grossProfit - expenseTotal);
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
    expenses: { lines: expenseLines, total: expenseTotal },
    netProfit,
    netMargin,
  };
}

// =======================================================================
// Balance Sheet
// =======================================================================
async function getBalanceSheet({ asOfDate }) {
  const asOf = dateOnly(asOfDate);

  // Cash drawer current balance.
  const { rows: cashRows } = await query(
    `SELECT COALESCE(current_balance, 0)::float8 AS bal FROM cash_drawer LIMIT 1`,
  );
  const cashBalance = money(cashRows[0]?.bal || 0);

  // Bank accounts (active).
  const { rows: bankRows } = await query(
    `SELECT id, account_name, bank_name, current_balance
       FROM bank_accounts
      WHERE is_active = true
      ORDER BY account_name`,
  );
  const banks = bankRows.map((r) => ({
    id: r.id,
    label: `${r.bank_name} – ${r.account_name}`,
    balance: money(r.current_balance),
  }));
  const bankTotal = money(banks.reduce((s, b) => s + b.balance, 0));

  // Receivables.
  const { rows: arRows } = await query(
    `SELECT COALESCE(SUM(credit_balance), 0)::float8 AS bal FROM customers`,
  );
  const receivables = money(arRows[0].bal || 0);

  // Inventory value: stock_qty × cost_price across all variants.
  const { rows: invRows } = await query(
    `SELECT COALESCE(SUM(stock_qty * cost_price), 0)::float8 AS bal
       FROM product_variants`,
  );
  const inventory = money(invRows[0].bal || 0);

  // Payables = open balance_due on purchase orders.
  const { rows: apRows } = await query(
    `SELECT COALESCE(SUM(balance_due), 0)::float8 AS bal
       FROM purchase_orders
      WHERE status NOT IN ('cancelled')`,
  );
  const payables = money(apRows[0].bal || 0);

  // VAT payable from the journal account, balance as of date.
  const { rows: vatRows } = await query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS bal
       FROM journal_lines jl
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE ca.code = '2002'
        AND je.date <= $1::date`,
    [asOf],
  );
  const vatPayable = money(vatRows[0].bal || 0);

  const totalAssets = money(cashBalance + bankTotal + receivables + inventory);
  const totalLiabilities = money(payables + vatPayable);
  const netEquity = money(totalAssets - totalLiabilities);

  return {
    asOfDate: asOf,
    assets: {
      cash: cashBalance,
      banks,
      banksTotal: bankTotal,
      receivables,
      inventory,
      total: totalAssets,
    },
    liabilities: {
      payables,
      vatPayable,
      total: totalLiabilities,
    },
    equity: { netEquity },
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

  // Output tax: sum of invoice tax_amount on confirmed invoices in period.
  const { rows: outRows } = await query(
    `SELECT COALESCE(SUM(taxable_amount), 0)::float8 AS net_sales,
            COALESCE(SUM(tax_amount),     0)::float8 AS output_tax
       FROM invoices
      WHERE status = 'confirmed'
        AND confirmed_at::date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const netSales = money(outRows[0].net_sales || 0);
  const outputTax = money(outRows[0].output_tax || 0);

  // Input tax: sum of purchase_orders.vat_amount in period (any received PO).
  const { rows: inRows } = await query(
    `SELECT COALESCE(SUM(subtotal),   0)::float8 AS net_purchases,
            COALESCE(SUM(vat_amount), 0)::float8 AS input_tax
       FROM purchase_orders
      WHERE status NOT IN ('cancelled','draft')
        AND created_at::date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const netPurchases = money(inRows[0].net_purchases || 0);
  const inputTax = money(inRows[0].input_tax || 0);

  const netPayable = money(outputTax - inputTax);

  // Due date: 28 days after the period end (UAE FTA quarterly cycle).
  const endD = new Date(`${to}T00:00:00`);
  endD.setDate(endD.getDate() + 28);
  const dueDate = endD.toISOString().slice(0, 10);

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
  qEnd.setDate(qEnd.getDate() + 28);
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
    expenses: { mtd: money(pl.cogs.total + pl.expenses.total),
      prev: money(prevPL.cogs.total + prevPL.expenses.total),
      delta: pctChange(
        pl.cogs.total + pl.expenses.total,
        prevPL.cogs.total + prevPL.expenses.total,
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
  getBalanceSheet,
  getCashFlowStatement,
  getVATReport,
  getDashboardSnapshot,
};
