const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const VALID_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);

function money(n) {
  n = Number(n) || 0;
  // Math.round(n*100)/100 alone mis-rounds values that land exactly on a
  // half-cent boundary due to IEEE-754 float representation (e.g. 2.90*0.05
  // is stored as 0.14499999999999999, rounding down to 0.14 instead of 0.15).
  // A tiny epsilon nudges genuine .xx5 boundaries the right way without
  // affecting any other value.
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

function dateOnly(input) {
  if (!input) return new Date().toISOString().slice(0, 10);
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

// =======================================================================
// Account lookups
// =======================================================================
let accountCache = null;
async function loadAccountsCache(client) {
  if (accountCache) return accountCache;
  const exec = client || { query: (sql, params) => query(sql, params) };
  const { rows } = await exec.query(
    `SELECT id, code, name, type, is_system, is_active FROM chart_of_accounts`,
  );
  accountCache = {
    byCode: new Map(rows.map((r) => [r.code, r])),
    byId: new Map(rows.map((r) => [r.id, r])),
    rows,
  };
  return accountCache;
}

function invalidateAccountsCache() {
  accountCache = null;
}

async function getAccountByCode(code, client) {
  const cache = await loadAccountsCache(client);
  const acc = cache.byCode.get(code);
  if (!acc) {
    throw new AppError(
      ERROR_CODES.BIZ_ACCOUNT_NOT_FOUND,
      `Chart of accounts code "${code}" not found — re-run migrations.`,
    );
  }
  return acc;
}

async function getAccountIdByCode(code, client) {
  return (await getAccountByCode(code, client)).id;
}

// Maps an expense category name to a chart-of-accounts code. Falls back to
// "Miscellaneous" (5014) so unknown categories never break a payment flow.
const EXPENSE_CATEGORY_TO_CODE = {
  Electricity: '5003',
  Water: '5004',
  Rent: '5005',
  Internet: '5006',
  'Trade License': '5007',
  'Government Fees': '5008',
  Insurance: '5009',
  Maintenance: '5010',
  Marketing: '5011',
  Transport: '5012',
  Miscellaneous: '5014',
  'Office Supplies': '5014',
};

async function getExpenseAccountIdForCategory(categoryName, client) {
  const code = EXPENSE_CATEGORY_TO_CODE[categoryName] || '5014';
  return getAccountIdByCode(code, client);
}

// =======================================================================
// Period lookup
// =======================================================================
// Pick the smallest period (i.e. the monthly one) for an exact date match.
// Quarterly + yearly periods are reporting buckets, never the posting target.
async function getPeriodForDate(date, client) {
  const exec = client || { query: (sql, params) => query(sql, params) };
  const { rows } = await exec.query(
    `SELECT * FROM financial_periods
      WHERE start_date <= $1::date AND end_date >= $1::date
      ORDER BY (end_date - start_date) ASC
      LIMIT 1`,
    [dateOnly(date)],
  );
  return rows[0] || null;
}

// Period rows are named and typed exactly like the 2026 seed in
// migrations/013_finance.sql ("March 2027"/monthly, "Q1 2027"/quarterly,
// "H1 2027"/yearly, "FY 2027"/yearly) so ON CONFLICT (name, period_type)
// dedupes against both the seed and earlier auto-created rows. Pure string
// arithmetic on YYYY-MM-DD — no Date/timezone round-trip can shift a boundary.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function isoDay(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function periodDefinitionsForDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return [];
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return [];
  const quarter = Math.ceil(month / 3);
  const qStart = (quarter - 1) * 3 + 1;
  const half = month <= 6 ? 1 : 2;
  const hStart = half === 1 ? 1 : 7;
  // Monthly first: callers insert in this fixed order so two concurrent
  // posters always take the unique-index locks in the same sequence.
  return [
    {
      name: `${MONTH_NAMES[month - 1]} ${year}`,
      type: 'monthly',
      start: isoDay(year, month, 1),
      end: isoDay(year, month, lastDayOfMonth(year, month)),
    },
    {
      name: `Q${quarter} ${year}`,
      type: 'quarterly',
      start: isoDay(year, qStart, 1),
      end: isoDay(year, qStart + 2, lastDayOfMonth(year, qStart + 2)),
    },
    {
      name: `H${half} ${year}`,
      type: 'yearly',
      start: isoDay(year, hStart, 1),
      end: isoDay(year, hStart + 5, lastDayOfMonth(year, hStart + 5)),
    },
    { name: `FY ${year}`, type: 'yearly', start: isoDay(year, 1, 1), end: isoDay(year, 12, 31) },
  ];
}

// Idempotently create the month/quarter/half/year periods covering `date`.
// Never touches an existing row, so a closed period stays closed.
async function ensurePeriodsForDate(date, client) {
  const exec = client || { query: (sql, params) => query(sql, params) };
  for (const p of periodDefinitionsForDate(dateOnly(date))) {
    await exec.query(
      `INSERT INTO financial_periods (name, period_type, start_date, end_date, status)
       VALUES ($1, $2, $3::date, $4::date, 'open')
       ON CONFLICT (name, period_type) DO NOTHING`,
      [p.name, p.type, p.start, p.end],
    );
  }
}

async function ensurePeriodsForYear(year, client) {
  for (let month = 1; month <= 12; month += 1) {
    await ensurePeriodsForDate(isoDay(year, month, 1), client);
  }
}

async function assertPeriodOpenFor(date, client) {
  let period = await getPeriodForDate(date, client);
  // Periods used to exist only for the seeded year, so every posting after
  // it failed with BIZ_PERIOD_NOT_FOUND. Create the covering periods on
  // demand. Also heal when only a quarterly/yearly bucket covers the date:
  // monthly is the intended posting target.
  if (!period || period.period_type !== 'monthly') {
    await ensurePeriodsForDate(date, client);
    period = await getPeriodForDate(date, client);
  }
  if (!period) {
    throw new AppError(
      ERROR_CODES.BIZ_PERIOD_NOT_FOUND,
      `No financial period covers ${dateOnly(date)} — create one before posting.`,
      { status: 409 },
    );
  }
  if (period.status === 'closed') {
    throw new AppError(
      ERROR_CODES.BIZ_PERIOD_CLOSED,
      `Period "${period.name}" is closed.`,
      { status: 409, details: { periodId: period.id, periodName: period.name } },
    );
  }
  return period;
}

// =======================================================================
// Sequential entry numbers (per calendar year, never reused).
// =======================================================================
async function nextEntryNumber(client, year) {
  const { rows } = await client.query(
    `INSERT INTO journal_entry_sequence (year, last_seq)
     VALUES ($1, 1)
     ON CONFLICT (year)
       DO UPDATE SET last_seq = journal_entry_sequence.last_seq + 1
     RETURNING last_seq`,
    [year],
  );
  const seq = rows[0].last_seq;
  return `JE-${year}-${String(seq).padStart(5, '0')}`;
}

// =======================================================================
// Public posting helper
// =======================================================================
async function postJournalEntryWith(client, params) {
  const {
    referenceType = null,
    referenceId = null,
    date,
    description,
    lines,
    isManual = false,
    userId = null,
  } = params;

  if (!description?.trim()) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Journal entries require a description.',
    );
  }
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Journal entries need at least two lines.',
    );
  }

  // Normalize + tally.
  const normalised = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const raw of lines) {
    const debit = money(raw.debit);
    const credit = money(raw.credit);
    if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
      throw new AppError(
        ERROR_CODES.BIZ_JOURNAL_UNBALANCED,
        'Each line must have a positive debit OR a positive credit, not both.',
      );
    }
    if (!raw.accountId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Journal lines require an account.',
      );
    }
    totalDebit = money(totalDebit + debit);
    totalCredit = money(totalCredit + credit);
    normalised.push({
      accountId: raw.accountId,
      debit,
      credit,
      notes: raw.notes || null,
    });
  }
  if (Math.abs(totalDebit - totalCredit) > 0.001 || totalDebit <= 0) {
    throw new AppError(
      ERROR_CODES.BIZ_JOURNAL_UNBALANCED,
      `Journal not balanced: debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)}.`,
      { status: 409, details: { totalDebit, totalCredit } },
    );
  }

  const entryDate = dateOnly(date);
  const period = await assertPeriodOpenFor(entryDate, client);

  const year = Number(entryDate.slice(0, 4));
  const entryNumber = await nextEntryNumber(client, year);

  const { rows: entryRows } = await client.query(
    `INSERT INTO journal_entries
       (entry_number, reference_type, reference_id, period_id, date,
        description, is_manual, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8)
     RETURNING *`,
    [
      entryNumber,
      referenceType,
      referenceId,
      period.id,
      entryDate,
      description.trim(),
      isManual,
      userId,
    ],
  );
  const entry = entryRows[0];

  for (const line of normalised) {
    await client.query(
      `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [entry.id, line.accountId, line.debit, line.credit, line.notes],
    );
  }

  return { entry, lines: normalised, period };
}

// Convenience wrapper for callers that want a one-shot transaction (manual
// journal entries from the UI). Auto-posting paths use postJournalEntryWith
// directly so the entry rides in the source transaction.
async function postJournalEntry(params) {
  const result = await withTransaction((client) =>
    postJournalEntryWith(client, params),
  );

  await logActivity({
    entityType: 'journal_entry',
    entityId: result.entry.id,
    action: params.isManual ? 'journal_entry.manual_posted' : 'journal_entry.posted',
    performedBy: params.userId || null,
    newValue: {
      entryNumber: result.entry.entry_number,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
    },
  });

  return result;
}

// =======================================================================
// Reversal helper — used by invoice cancel etc. Generates a new entry that
// swaps debits and credits of every line of the source entry.
// =======================================================================
async function reverseJournalEntryWith(client, sourceEntryId, { description, date, userId }) {
  const { rows: srcRows } = await client.query(
    `SELECT * FROM journal_entries WHERE id = $1`,
    [sourceEntryId],
  );
  if (!srcRows.length) return null;
  const src = srcRows[0];

  const { rows: srcLines } = await client.query(
    `SELECT * FROM journal_lines WHERE journal_entry_id = $1`,
    [sourceEntryId],
  );
  if (!srcLines.length) return null;

  const reversed = srcLines.map((l) => ({
    accountId: l.account_id,
    debit: money(l.credit),
    credit: money(l.debit),
    notes: `Reverses ${src.entry_number}`,
  })).filter((l) => l.debit > 0 || l.credit > 0);

  return postJournalEntryWith(client, {
    referenceType: src.reference_type,
    referenceId: src.reference_id,
    date: date || new Date().toISOString().slice(0, 10),
    description: description || `Reversal of ${src.entry_number}`,
    lines: reversed,
    userId,
  });
}

// =======================================================================
// Domain-specific posting helpers — these own the per-flow account choices
// so the calling services stay readable.
// =======================================================================

// Sale: split payments produce one revenue entry. `payments` is an array of
// { method, amount, bankAccountId? } where method ∈ cash | bank | credit.
async function postSaleEntry(client, {
  invoiceId,
  invoiceNumber,
  date,
  subtotal,
  taxAmount,
  payments,
  cogsAmount,
  thirdPartyCostAmount = 0,
  userId,
}) {
  const lines = [];
  // Debits: one per payment method that landed money in cash/bank/receivable.
  let creditTotal = 0;
  for (const p of payments) {
    const amt = money(p.amount);
    if (amt <= 0) continue;
    if (p.method === 'cash') {
      lines.push({ accountId: await getAccountIdByCode('1001', client), debit: amt, credit: 0 });
    } else if (p.method === 'bank') {
      lines.push({ accountId: await getAccountIdByCode('1002', client), debit: amt, credit: 0 });
    } else if (p.method === 'credit') {
      lines.push({ accountId: await getAccountIdByCode('1003', client), debit: amt, credit: 0 });
      creditTotal += amt;
    }
  }
  // Credits: revenue + (optional) VAT payable.
  const sub = money(subtotal);
  const tax = money(taxAmount);
  if (sub > 0) {
    lines.push({ accountId: await getAccountIdByCode('4001', client), debit: 0, credit: sub });
  }
  if (tax > 0) {
    lines.push({ accountId: await getAccountIdByCode('2002', client), debit: 0, credit: tax });
  }

  const saleEntry = lines.length ? await postJournalEntryWith(client, {
    referenceType: 'invoice',
    referenceId: invoiceId,
    date,
    description: `Sale ${invoiceNumber}`,
    lines,
    userId,
  }) : null;

  // COGS pass: DR COGS, CR Inventory. Always uses the invoice's date.
  if (money(cogsAmount) > 0) {
    await postJournalEntryWith(client, {
      referenceType: 'invoice',
      referenceId: invoiceId,
      date,
      description: `COGS for ${invoiceNumber}`,
      lines: [
        {
          accountId: await getAccountIdByCode('5001', client),
          debit: money(cogsAmount),
          credit: 0,
        },
        {
          accountId: await getAccountIdByCode('1004', client),
          debit: 0,
          credit: money(cogsAmount),
        },
      ],
      userId,
    });
  }

  // Third-party/custom item cost pass: DR COGS same as a normal sale (so
  // gross profit still reflects reality), but CR Accounts Payable instead
  // of Inventory — this good was never held in stock, so there's nothing
  // to draw down there. There's no per-supplier ledger for these (the
  // third party is a free-text name on the line, not a tracked supplier
  // record), so it lands in the shop's general payables balance.
  if (money(thirdPartyCostAmount) > 0) {
    await postJournalEntryWith(client, {
      referenceType: 'invoice',
      referenceId: invoiceId,
      date,
      description: `Third-party item cost for ${invoiceNumber}`,
      lines: [
        {
          accountId: await getAccountIdByCode('5001', client),
          debit: money(thirdPartyCostAmount),
          credit: 0,
        },
        {
          accountId: await getAccountIdByCode('2001', client),
          debit: 0,
          credit: money(thirdPartyCostAmount),
        },
      ],
      userId,
    });
  }

  return saleEntry;
}

async function reverseSaleEntries(client, invoiceId, { invoiceNumber, date, userId }) {
  const { rows } = await client.query(
    `SELECT l.account_id, SUM(l.debit - l.credit)::numeric AS balance
       FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
      WHERE e.reference_type = 'invoice' AND e.reference_id = $1
      GROUP BY l.account_id`,
    [invoiceId],
  );
  // Reverse the remaining net footprint, including earlier corrections.
  // Reversing each historical entry separately grows exponentially on edits.
  const lines = rows.filter((r) => money(r.balance) !== 0).map((r) => ({
    accountId: r.account_id,
    debit: Math.max(0, -money(r.balance)),
    credit: Math.max(0, money(r.balance)),
  }));
  if (!lines.length) return null;
  return postJournalEntryWith(client, {
    referenceType: 'invoice', referenceId: invoiceId,
    description: `Reversal of ${invoiceNumber}`, date, userId, lines,
  });
}

// Returning sold units restores their original inventory cost. Replacement
// sales then consume their own cost, so an exchange records only the net COGS.
async function postReturnedInventoryEntry(client, { returnOrderId, returnOrderNumber, amount, date, userId }) {
  const value = money(amount);
  if (value <= 0) return null;
  return postJournalEntryWith(client, {
    referenceType: 'return_order', referenceId: returnOrderId, date, userId,
    description: `Inventory returned for ${returnOrderNumber}`,
    lines: [
      { accountId: await getAccountIdByCode('1004', client), debit: value, credit: 0 },
      { accountId: await getAccountIdByCode('5001', client), debit: 0, credit: value },
    ],
  });
}

// Returning defective/excess stock to a supplier: the inventory asset goes
// down (credit 1004) and what we owe the supplier goes down by the same
// cost value (debit 2001 Accounts Payable) — the mirror of
// postPurchaseReceiveEntry's DR inventory / CR payable on receipt.
async function postSupplierReturnEntry(client, { returnOrderId, returnOrderNumber, amount, date, userId }) {
  const value = money(amount);
  if (value <= 0) return null;
  return postJournalEntryWith(client, {
    referenceType: 'return_order', referenceId: returnOrderId, date, userId,
    description: `Supplier return ${returnOrderNumber}`,
    lines: [
      { accountId: await getAccountIdByCode('2001', client), debit: value, credit: 0 },
      { accountId: await getAccountIdByCode('1004', client), debit: 0, credit: value },
    ],
  });
}

// Customer pays down their credit balance: DR cash/bank, CR receivable.
async function postCustomerPaymentEntry(client, {
  paymentId,
  amount,
  method,
  bankAccountId: _bank,
  customerName,
  date,
  userId,
}) {
  const amt = money(amount);
  if (amt <= 0) return null;
  const debitCode = method === 'cash' ? '1001' : '1002';
  return postJournalEntryWith(client, {
    referenceType: 'customer_payment',
    referenceId: paymentId,
    date,
    description: `Collection from ${customerName || 'customer'}`,
    lines: [
      { accountId: await getAccountIdByCode(debitCode, client), debit: amt, credit: 0 },
      { accountId: await getAccountIdByCode('1003', client), debit: 0, credit: amt },
    ],
    userId,
  });
}

// Customer payment void: reverse the original payment journal entries.
async function reverseCustomerPaymentEntries(client, paymentId, { date, userId }) {
  const { rows } = await client.query(
    `SELECT id FROM journal_entries
      WHERE reference_type = 'customer_payment' AND reference_id = $1
      ORDER BY created_at ASC`,
    [paymentId],
  );
  for (const r of rows) {
    await reverseJournalEntryWith(client, r.id, {
      description: 'Reversal of customer payment',
      date,
      userId,
    });
  }
}

// PO received: DR inventory, CR accounts payable. Posted line-by-line value.
async function postPurchaseReceiveEntry(client, {
  poId,
  poNumber,
  date,
  inventoryValue,
  vatAmount,
  userId,
}) {
  const inv = money(inventoryValue);
  const vat = money(vatAmount);
  if (inv <= 0 && vat <= 0) return null;
  const totalPayable = money(inv + vat);
  const lines = [];
  if (inv > 0) {
    lines.push({ accountId: await getAccountIdByCode('1004', client), debit: inv, credit: 0 });
  }
  if (vat > 0) {
    // Input VAT — a reduction of VAT Payable (debit the same account).
    lines.push({ accountId: await getAccountIdByCode('2002', client), debit: vat, credit: 0 });
  }
  lines.push({
    accountId: await getAccountIdByCode('2001', client),
    debit: 0,
    credit: totalPayable,
  });
  return postJournalEntryWith(client, {
    referenceType: 'purchase_order',
    referenceId: poId,
    date,
    description: `PO ${poNumber || ''} received`,
    lines,
    userId,
  });
}

// Supplier payment: DR payables, CR cash/bank.
async function postSupplierPaymentEntry(client, {
  paymentId,
  amount,
  method,
  poNumber,
  date,
  userId,
}) {
  const amt = money(amount);
  if (amt <= 0) return null;
  const creditCode = method === 'cash' ? '1001' : '1002';
  return postJournalEntryWith(client, {
    referenceType: 'supplier_payment',
    referenceId: paymentId,
    date,
    description: `Payment to supplier on ${poNumber || ''}`.trim(),
    lines: [
      { accountId: await getAccountIdByCode('2001', client), debit: amt, credit: 0 },
      { accountId: await getAccountIdByCode(creditCode, client), debit: 0, credit: amt },
    ],
    userId,
  });
}

async function reverseSupplierPaymentEntries(client, paymentId, { date, userId }) {
  const { rows } = await client.query(
    `SELECT id FROM journal_entries
      WHERE reference_type = 'supplier_payment' AND reference_id = $1
      ORDER BY created_at ASC`,
    [paymentId],
  );
  for (const r of rows) {
    await reverseJournalEntryWith(client, r.id, {
      description: 'Reversal of supplier payment',
      date,
      userId,
    });
  }
}

// Bill payment: DR expense_account_for_category, CR cash/bank.
async function postBillPaymentEntry(client, {
  billPaymentId,
  amount,
  method,
  categoryName,
  billName,
  date,
  userId,
}) {
  const amt = money(amount);
  if (amt <= 0) return null;
  const expenseAccountId = await getExpenseAccountIdForCategory(categoryName, client);
  const creditCode = method === 'cash' ? '1001' : '1002';
  return postJournalEntryWith(client, {
    referenceType: 'bill_payment',
    referenceId: billPaymentId,
    date,
    description: `Bill: ${billName || categoryName || 'expense'}`,
    lines: [
      { accountId: expenseAccountId, debit: amt, credit: 0 },
      { accountId: await getAccountIdByCode(creditCode, client), debit: 0, credit: amt },
    ],
    userId,
  });
}

// One-time expense: same shape as bill payment.
async function postExpenseEntry(client, {
  expenseId,
  amount,
  method,
  categoryName,
  description,
  date,
  userId,
}) {
  const amt = money(amount);
  if (amt <= 0) return null;
  const expenseAccountId = await getExpenseAccountIdForCategory(categoryName, client);
  const creditCode = method === 'cash' ? '1001' : '1002';
  return postJournalEntryWith(client, {
    referenceType: 'expense',
    referenceId: expenseId,
    date,
    description: `Expense: ${description}`.slice(0, 250),
    lines: [
      { accountId: expenseAccountId, debit: amt, credit: 0 },
      { accountId: await getAccountIdByCode(creditCode, client), debit: 0, credit: amt },
    ],
    userId,
  });
}

async function reverseExpenseEntries(client, expenseId, { date, userId }) {
  const { rows } = await client.query(
    `SELECT id FROM journal_entries
      WHERE reference_type = 'expense' AND reference_id = $1
      ORDER BY created_at ASC`,
    [expenseId],
  );
  for (const r of rows) {
    await reverseJournalEntryWith(client, r.id, {
      description: 'Reversal of expense',
      date,
      userId,
    });
  }
}

// Customer refund (return): DR Refunds Given, CR cash/bank or receivable.
async function postRefundEntry(client, {
  returnOrderId,
  returnOrderNumber,
  amount,
  method,
  date,
  userId,
  taxRate = 0,
}) {
  const amt = money(amount);
  if (amt <= 0) return null;
  let creditCode;
  if (method === 'cash') creditCode = '1001';
  else if (method === 'bank') creditCode = '1002';
  else creditCode = '1003'; // credit refund = bumps receivable down via opposite

  // A refund reverses the original sale — it must debit the same accounts
  // postSaleEntry credited (Sales Revenue + VAT Payable), not book against
  // an unrelated "Refunds Given" expense account. Debiting 5013 instead
  // left revenue and the VAT liability completely untouched, so a FULL
  // refund of a sale showed up as a pure loss (revenue - refund-as-expense)
  // rather than netting to zero, and the VAT report kept showing tax due
  // on a sale that no longer exists.
  const rate = Number(taxRate) || 0;
  const revenuePortion = rate > 0 ? money(amt / (1 + rate / 100)) : amt;
  const vatPortion = money(amt - revenuePortion);

  const lines = [
    { accountId: await getAccountIdByCode('4001', client), debit: revenuePortion, credit: 0 },
  ];
  if (vatPortion > 0) {
    lines.push({ accountId: await getAccountIdByCode('2002', client), debit: vatPortion, credit: 0 });
  }
  lines.push({ accountId: await getAccountIdByCode(creditCode, client), debit: 0, credit: amt });

  return postJournalEntryWith(client, {
    referenceType: 'return_order',
    referenceId: returnOrderId,
    date,
    description: `Refund for ${returnOrderNumber}`,
    lines,
    userId,
  });
}

// Stock adjustment: inventory value moves up/down against owner equity.
// `delta` is signed (positive = increase, negative = decrease).
async function postStockAdjustmentEntry(client, {
  movementId,
  movementType,
  variantId,
  delta,
  costPrice,
  date,
  userId,
}) {
  const value = money(Math.abs(Number(delta) * Number(costPrice)));
  if (value <= 0) return null;
  const increase = Number(delta) > 0;
  const lines = increase
    ? [
        { accountId: await getAccountIdByCode('1004', client), debit: value, credit: 0 },
        { accountId: await getAccountIdByCode('3001', client), debit: 0, credit: value },
      ]
    : [
        { accountId: await getAccountIdByCode('3001', client), debit: value, credit: 0 },
        { accountId: await getAccountIdByCode('1004', client), debit: 0, credit: value },
      ];
  return postJournalEntryWith(client, {
    referenceType: 'stock_movement',
    referenceId: movementId,
    date,
    description: `Stock ${movementType} on variant ${variantId}`,
    lines,
    userId,
  });
}

// =======================================================================
// Period management
// =======================================================================
async function listPeriods({ status = null } = {}) {
  const { rows } = await query(
    `SELECT p.*, u.username AS closed_by_username
       FROM financial_periods p
       LEFT JOIN users u ON u.id = p.closed_by
       ${status ? 'WHERE p.status = $1' : ''}
       ORDER BY p.start_date DESC, p.period_type`,
    status ? [status] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.period_type,
    startDate: dateOnly(r.start_date),
    endDate: dateOnly(r.end_date),
    status: r.status,
    closedBy: r.closed_by,
    closedByUsername: r.closed_by_username,
    closedAt: r.closed_at,
    notes: r.notes,
  }));
}

// Block close if there's anything still draft / in-progress in the window.
async function periodCloseChecklist(period) {
  const { rows: invoices } = await query(
    `SELECT COUNT(*)::int AS n FROM invoices
      WHERE status = 'draft' AND created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')`,
    [period.start_date, period.end_date],
  );
  const { rows: pos } = await query(
    `SELECT COUNT(*)::int AS n FROM purchase_orders
      WHERE status IN ('draft','confirmed','partially_received')
        AND created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')`,
    [period.start_date, period.end_date],
  );
  const { rows: returns } = await query(
    `SELECT COUNT(*)::int AS n FROM return_requests
      WHERE status = 'pending' AND created_at BETWEEN $1::date AND ($2::date + INTERVAL '1 day')`,
    [period.start_date, period.end_date],
  );
  const items = [
    {
      key: 'invoices',
      label: 'All invoices confirmed or cancelled',
      pending: invoices[0].n,
      ok: invoices[0].n === 0,
    },
    {
      key: 'purchase_orders',
      label: 'All purchase orders received or cancelled',
      pending: pos[0].n,
      ok: pos[0].n === 0,
    },
    {
      key: 'return_requests',
      label: 'No pending return requests',
      pending: returns[0].n,
      ok: returns[0].n === 0,
    },
  ];
  return items;
}

async function ensureNextPeriodAfter(client, period) {
  if (period.period_type !== 'monthly') return;
  // pg parses DATE as local midnight, so read it with local getters —
  // toISOString() would roll it back a day for positive UTC offsets.
  const end = period.end_date instanceof Date
    ? period.end_date
    : new Date(`${String(period.end_date).slice(0, 10)}T00:00:00`);
  let year = end.getFullYear();
  let month = end.getMonth() + 2; // month after end_date, 1-based
  if (month > 12) {
    month = 1;
    year += 1;
  }
  await ensurePeriodsForDate(isoDay(year, month, 1), client);
}

async function closePeriod({ periodId, userId, force = false, notes = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM financial_periods WHERE id = $1 FOR UPDATE`,
      [periodId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const period = rows[0];
    if (period.status === 'closed') {
      throw new AppError(
        ERROR_CODES.BIZ_PERIOD_CLOSED,
        `Period "${period.name}" is already closed.`,
        { status: 409 },
      );
    }
    if (!force) {
      const checklist = await periodCloseChecklist(period);
      const pending = checklist.filter((c) => !c.ok);
      if (pending.length) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'There are pending items in this period.',
          { status: 409, details: { checklist } },
        );
      }
    }
    await client.query(
      `UPDATE financial_periods
          SET status = 'closed', closed_by = $1, closed_at = NOW(), notes = COALESCE($2, notes)
        WHERE id = $3`,
      [userId || null, notes, periodId],
    );

    await ensureNextPeriodAfter(client, period);

    await logActivity({
      entityType: 'financial_period',
      entityId: periodId,
      action: 'financial_period.closed',
      performedBy: userId,
      newValue: { name: period.name },
    });

    const refreshed = (
      await client.query(`SELECT * FROM financial_periods WHERE id = $1`, [periodId])
    ).rows[0];
    return refreshed;
  });
}

// =======================================================================
// Chart of accounts management
// =======================================================================
async function listAccounts() {
  const { rows } = await query(
    `SELECT c.*, p.code AS parent_code
       FROM chart_of_accounts c
       LEFT JOIN chart_of_accounts p ON p.id = c.parent_id
      ORDER BY c.code`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    parentId: r.parent_id,
    parentCode: r.parent_code,
    isSystem: r.is_system,
    isActive: r.is_active,
    description: r.description,
  }));
}

async function addAccount({ code, name, type, parentId = null, description = null, userId }) {
  if (!VALID_TYPES.has(type)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid account type.');
  }
  try {
    const { rows } = await query(
      `INSERT INTO chart_of_accounts (code, name, type, parent_id, description, is_system, is_active)
       VALUES ($1,$2,$3,$4,$5,false,true) RETURNING *`,
      [code, name, type, parentId, description],
    );
    invalidateAccountsCache();
    await logActivity({
      entityType: 'chart_of_accounts',
      entityId: rows[0].id,
      action: 'chart_of_accounts.account_added',
      performedBy: userId,
      newValue: { code, name, type },
    });
    return rows[0];
  } catch (e) {
    if (e?.code === '23505') {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'An account with that code already exists.',
        { status: 409 },
      );
    }
    throw e;
  }
}

async function updateAccount({ id, name, description, isActive, userId }) {
  const { rows: existing } = await query(
    `SELECT * FROM chart_of_accounts WHERE id = $1`,
    [id],
  );
  if (!existing.length) {
    throw new AppError(ERROR_CODES.BIZ_ACCOUNT_NOT_FOUND, undefined, { status: 404 });
  }
  if (existing[0].is_system && name && name !== existing[0].name) {
    throw new AppError(ERROR_CODES.BIZ_ACCOUNT_SYSTEM, undefined, { status: 409 });
  }
  const { rows } = await query(
    `UPDATE chart_of_accounts
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            is_active = COALESCE($3, is_active)
      WHERE id = $4
      RETURNING *`,
    [name || null, description || null, isActive == null ? null : isActive, id],
  );
  invalidateAccountsCache();
  await logActivity({
    entityType: 'chart_of_accounts',
    entityId: id,
    action: 'chart_of_accounts.account_updated',
    performedBy: userId,
    newValue: { name },
  });
  return rows[0];
}

async function deleteAccount({ id, userId }) {
  const { rows } = await query(`SELECT * FROM chart_of_accounts WHERE id = $1`, [id]);
  if (!rows.length) {
    throw new AppError(ERROR_CODES.BIZ_ACCOUNT_NOT_FOUND, undefined, { status: 404 });
  }
  if (rows[0].is_system) {
    throw new AppError(ERROR_CODES.BIZ_ACCOUNT_SYSTEM, undefined, { status: 409 });
  }
  const { rows: usage } = await query(
    `SELECT COUNT(*)::int AS n FROM journal_lines WHERE account_id = $1`,
    [id],
  );
  if (usage[0].n > 0) {
    throw new AppError(ERROR_CODES.BIZ_ACCOUNT_IN_USE, undefined, { status: 409 });
  }
  await query(`DELETE FROM chart_of_accounts WHERE id = $1`, [id]);
  invalidateAccountsCache();
  await logActivity({
    entityType: 'chart_of_accounts',
    entityId: id,
    action: 'chart_of_accounts.account_deleted',
    performedBy: userId,
  });
  return { deleted: true };
}

// =======================================================================
// Journal listing + detail
// =======================================================================
async function listEntries({
  from = null,
  to = null,
  referenceType = null,
  accountId = null,
  isManual = null,
  limit = 50,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (from) {
    parts.push(`e.date >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    parts.push(`e.date <= $${i++}::date`);
    params.push(to);
  }
  if (referenceType) {
    parts.push(`e.reference_type = $${i++}`);
    params.push(referenceType);
  }
  if (isManual !== null && isManual !== undefined) {
    parts.push(`e.is_manual = $${i++}`);
    params.push(isManual);
  }
  if (accountId) {
    parts.push(
      `EXISTS (SELECT 1 FROM journal_lines jl
                WHERE jl.journal_entry_id = e.id AND jl.account_id = $${i++})`,
    );
    params.push(accountId);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT e.*, u.username AS created_by_username, p.name AS period_name, p.status AS period_status,
            (SELECT COUNT(*)::int FROM journal_lines jl WHERE jl.journal_entry_id = e.id) AS line_count,
            (SELECT COALESCE(SUM(jl.debit),0)::float8 FROM journal_lines jl WHERE jl.journal_entry_id = e.id) AS total_debit,
            (SELECT COALESCE(SUM(jl.credit),0)::float8 FROM journal_lines jl WHERE jl.journal_entry_id = e.id) AS total_credit
       FROM journal_entries e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN financial_periods p ON p.id = e.period_id
       ${where}
       ORDER BY e.date DESC, e.entry_number DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total FROM journal_entries e ${where}`,
    params,
  );
  return {
    rows: rows.map(shapeEntry),
    total: tot[0].total,
  };
}

async function getEntry(id) {
  const { rows } = await query(
    `SELECT e.*, u.username AS created_by_username,
            p.name AS period_name, p.status AS period_status
       FROM journal_entries e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN financial_periods p ON p.id = e.period_id
      WHERE e.id = $1`,
    [id],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  }
  const { rows: lines } = await query(
    `SELECT jl.*, ca.code AS account_code, ca.name AS account_name, ca.type AS account_type
       FROM journal_lines jl
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
      WHERE jl.journal_entry_id = $1
      ORDER BY jl.debit DESC, ca.code`,
    [id],
  );
  // Unlike listEntries, this row query has no total_debit/total_credit
  // subqueries, so shapeEntry() would read those as undefined -> 0 and
  // always report "0.00 / 0.00, balanced: true" regardless of the entry's
  // actual lines. Derive them from the `lines` we already fetched instead.
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return {
    ...shapeEntry(rows[0]),
    totalDebit: money(totalDebit),
    totalCredit: money(totalCredit),
    balanced: Math.abs(totalDebit - totalCredit) < 0.001,
    lines: lines.map((l) => ({
      id: l.id,
      accountId: l.account_id,
      accountCode: l.account_code,
      accountName: l.account_name,
      accountType: l.account_type,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      notes: l.notes,
    })),
  };
}

function shapeEntry(row) {
  return {
    id: row.id,
    entryNumber: row.entry_number,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    periodId: row.period_id,
    periodName: row.period_name,
    periodStatus: row.period_status,
    date: row.date ? dateOnly(row.date) : null,
    description: row.description,
    isManual: row.is_manual,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    lineCount: row.line_count,
    totalDebit: Number(row.total_debit || 0),
    totalCredit: Number(row.total_credit || 0),
    balanced:
      Math.abs(Number(row.total_debit || 0) - Number(row.total_credit || 0)) < 0.001,
  };
}

module.exports = {
  // Engine
  postJournalEntry,
  postJournalEntryWith,
  reverseJournalEntryWith,
  invalidateAccountsCache,
  // Domain helpers
  postSaleEntry,
  postReturnedInventoryEntry,
  postSupplierReturnEntry,
  reverseSaleEntries,
  postCustomerPaymentEntry,
  reverseCustomerPaymentEntries,
  postPurchaseReceiveEntry,
  postSupplierPaymentEntry,
  reverseSupplierPaymentEntries,
  postBillPaymentEntry,
  postExpenseEntry,
  reverseExpenseEntries,
  postRefundEntry,
  postStockAdjustmentEntry,
  // Lookups
  getAccountByCode,
  getAccountIdByCode,
  getExpenseAccountIdForCategory,
  getPeriodForDate,
  assertPeriodOpenFor,
  periodDefinitionsForDate,
  ensurePeriodsForDate,
  ensurePeriodsForYear,
  // CRUD
  listAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  listPeriods,
  periodCloseChecklist,
  closePeriod,
  listEntries,
  getEntry,
};
