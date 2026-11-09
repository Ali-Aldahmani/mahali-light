const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { runOnce } = require('../utils/operations');
const journalService = require('./journalService');
const bankService = require('./bankService');

// Card processing fees (migration 060). A fee is worked out on the card-paid
// part of a sale when it is confirmed, from the provider's rates at that
// moment, and stored with those rates. Refunds always give the customer the
// full amount; what happens to the store's fee is the provider's refund
// policy. Fees post to 5017 against the bank account the card money went to.

const FEE_ACCOUNT = '5017';
const BANK_ACCOUNT = '1002';

function money(n) {
  n = Number(n) || 0;
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

// A fee by method on `base`, never more than the base itself.
function computeFee(method, percent, fixed, base) {
  const amount = money(base);
  if (amount <= 0 || !method || method === 'none') return 0;
  let fee = 0;
  if (method === 'percent' || method === 'percent_fixed') fee += (amount * Number(percent || 0)) / 100;
  if (method === 'fixed' || method === 'percent_fixed') fee += Number(fixed || 0);
  return Math.min(money(fee), amount);
}

function shapeProvider(row) {
  return {
    id: row.id,
    name: row.name,
    bankAccountId: row.bank_account_id,
    feeMethod: row.fee_method,
    feePercent: Number(row.fee_percent),
    feeFixed: Number(row.fee_fixed),
    refundFeePolicy: row.refund_fee_policy,
    refundChargeMethod: row.refund_charge_method,
    refundChargePercent: Number(row.refund_charge_percent),
    refundChargeFixed: Number(row.refund_charge_fixed),
    isDefault: row.is_default,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

async function listProviders({ includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM payment_providers WHERE $1 OR is_active ORDER BY is_default DESC, lower(name)`,
    [includeInactive],
  );
  return rows.map(shapeProvider);
}

const COLUMNS = {
  name: 'name',
  bankAccountId: 'bank_account_id',
  feeMethod: 'fee_method',
  feePercent: 'fee_percent',
  feeFixed: 'fee_fixed',
  refundFeePolicy: 'refund_fee_policy',
  refundChargeMethod: 'refund_charge_method',
  refundChargePercent: 'refund_charge_percent',
  refundChargeFixed: 'refund_charge_fixed',
  isDefault: 'is_default',
  isActive: 'is_active',
};

async function clearOtherDefaults(client, keepId) {
  await client.query(
    `UPDATE payment_providers SET is_default = false, updated_at = NOW() WHERE is_default AND id <> $1`, [keepId],
  );
}

function duplicateName(err) {
  if (err.code === '23505') {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, 'A card provider with that name already exists.', { status: 409 });
  }
  return err;
}

async function createProvider(input, { userId, requestKey = null }) {
  return withTransaction(async (client) => {
    const { result } = await runOnce(client, {
      scope: 'payment_provider_create', key: requestKey, payload: input, userId,
    }, async () => {
      const keys = Object.keys(COLUMNS).filter((k) => input[k] !== undefined);
      const cols = keys.map((k) => COLUMNS[k]);
      const vals = keys.map((k) => input[k]);
      let row;
      try {
        ({ rows: [row] } = await client.query(
          `INSERT INTO payment_providers (${cols.join(', ')}, created_by, updated_by)
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 1})
           RETURNING *`,
          [...vals, userId],
        ));
      } catch (err) {
        throw duplicateName(err);
      }
      if (row.is_default) await clearOtherDefaults(client, row.id);
      await logActivity({
        client, entityType: 'payment_provider', entityId: row.id, action: 'payment_provider.created',
        performedBy: userId, newValue: shapeProvider(row),
      });
      return shapeProvider(row);
    });
    return result;
  });
}

async function updateProvider(id, patch, { userId }) {
  return withTransaction(async (client) => {
    const { rows: [before] } = await client.query(`SELECT * FROM payment_providers WHERE id = $1 FOR UPDATE`, [id]);
    if (!before) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Card provider not found.', { status: 404 });
    const keys = Object.keys(COLUMNS).filter((k) => patch[k] !== undefined);
    if (!keys.length) return shapeProvider(before);
    let row;
    try {
      ({ rows: [row] } = await client.query(
        `UPDATE payment_providers
            SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')},
                updated_by = $${keys.length + 2}, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, ...keys.map((k) => patch[k]), userId],
      ));
    } catch (err) {
      throw duplicateName(err);
    }
    if (row.is_default && row.is_active) await clearOtherDefaults(client, row.id);
    // Rates already applied to sales are stored on each fee row; changing a
    // provider only affects sales confirmed from now on.
    await logActivity({
      client, entityType: 'payment_provider', entityId: id, action: 'payment_provider.updated',
      performedBy: userId, oldValue: shapeProvider(before), newValue: shapeProvider(row),
    });
    return shapeProvider(row);
  });
}

async function postFeeMovement(client, { feeRowId, amount, bankAccountId, description, date, userId }) {
  const value = money(amount);
  if (value === 0) return;
  const expense = await journalService.getAccountIdByCode(FEE_ACCOUNT, client);
  const bank = await journalService.getAccountIdByCode(BANK_ACCOUNT, client);
  await journalService.postJournalEntryWith(client, {
    referenceType: 'payment_fee',
    referenceId: feeRowId,
    date,
    description,
    userId,
    lines: value > 0
      ? [{ accountId: expense, debit: value, credit: 0 }, { accountId: bank, debit: 0, credit: value }]
      : [{ accountId: bank, debit: -value, credit: 0 }, { accountId: expense, debit: 0, credit: -value }],
  });
  const move = value > 0 ? bankService.recordBankOut : bankService.recordBankIn;
  await move({
    client,
    bankAccountId: bankAccountId || null,
    transactionType: 'expense',
    amount: Math.abs(value),
    referenceType: 'payment_fee',
    referenceId: feeRowId,
    employeeId: userId,
    description,
    allowOverdraft: true,
    allowInactiveAccount: true,
  });
}

async function resolveProvider(client, providerId) {
  const { rows } = await client.query(
    providerId
      ? `SELECT * FROM payment_providers WHERE id = $1`
      : `SELECT * FROM payment_providers WHERE is_default AND is_active LIMIT 1`,
    providerId ? [providerId] : [],
  );
  return rows[0] || null;
}

/**
 * Records and posts the fee on each card payment of a sale being confirmed.
 * Runs once per payment: a second call finds the fee already there.
 */
async function recordSaleFees(client, { invoice, payments, userId, date }) {
  let total = 0;
  for (const pm of payments) {
    if (pm.method !== 'bank' || pm.tender !== 'card') continue;
    const provider = await resolveProvider(client, pm.provider_id);
    if (!provider) continue;
    if (!pm.provider_id) {
      await client.query(`UPDATE invoice_payments SET provider_id = $2 WHERE id = $1`, [pm.id, provider.id]);
    }
    const fee = computeFee(provider.fee_method, provider.fee_percent, provider.fee_fixed, pm.amount);
    const { rows: [row] } = await client.query(
      `INSERT INTO payment_fees
         (invoice_id, invoice_payment_id, provider_id, provider_name, kind, source_type, source_id,
          base_amount, fee_method, fee_percent, fee_fixed, fee_amount, amount, bank_account_id, fee_date, created_by)
       VALUES ($1, $2, $3, $4, 'charge', 'invoice', $1, $5, $6, $7, $8, $9, $9, $10, $11, $12)
       ON CONFLICT (kind, source_type, source_id, invoice_payment_id) DO NOTHING
       RETURNING id`,
      [invoice.id, pm.id, provider.id, provider.name, money(pm.amount), provider.fee_method,
        provider.fee_percent, provider.fee_fixed, fee, pm.bank_account_id, date, userId],
    );
    if (!row) continue;
    total = money(total + fee);
    await postFeeMovement(client, {
      feeRowId: row.id, amount: fee, bankAccountId: pm.bank_account_id, date, userId,
      description: `Card fee (${provider.name}) on ${invoice.invoice_number}`,
    });
  }
  return total;
}

/**
 * Card money going back to a customer: `cardAmount` of the invoice's card
 * payments (taken in payment order, up to what each still has unrefunded).
 * The customer's refund is not touched here. The store's fee follows each
 * provider's policy. One event per (source, payment); repeats do nothing.
 */
async function recordRefundFees(client, { invoiceId, sourceType, sourceId, cardAmount = null, userId, date, label }) {
  const { rows: charges } = await client.query(
    `SELECT c.*, COALESCE(r.base, 0)::numeric AS refunded_base, COALESCE(r.fee_back, 0)::numeric AS fee_back,
            p.refund_fee_policy, p.refund_charge_method, p.refund_charge_percent, p.refund_charge_fixed
       FROM payment_fees c
       LEFT JOIN (SELECT invoice_payment_id, SUM(base_amount) AS base, SUM(fee_refunded) AS fee_back
                    FROM payment_fees WHERE kind = 'refund' AND invoice_id = $1
                   GROUP BY invoice_payment_id) r ON r.invoice_payment_id = c.invoice_payment_id
       LEFT JOIN payment_providers p ON p.id = c.provider_id
      WHERE c.invoice_id = $1 AND c.kind = 'charge'
      ORDER BY c.created_at, c.id
      FOR UPDATE OF c`,
    [invoiceId],
  );
  let left = cardAmount == null ? Infinity : money(cardAmount);
  let net = 0;
  for (const c of charges) {
    if (left <= 0) break;
    const open = money(Number(c.base_amount) - Number(c.refunded_base));
    const portion = money(Math.min(open, left));
    if (portion <= 0) continue;
    left = money(left - portion);
    const feeBack = c.refund_fee_policy === 'proportional'
      ? Math.min(
        money((Number(c.fee_amount) * portion) / Number(c.base_amount)),
        money(Number(c.fee_amount) - Number(c.fee_back)),
      )
      : 0;
    const charge = computeFee(c.refund_charge_method, c.refund_charge_percent, c.refund_charge_fixed, portion);
    const amount = money(charge - feeBack);
    const { rows: [row] } = await client.query(
      `INSERT INTO payment_fees
         (invoice_id, invoice_payment_id, provider_id, provider_name, kind, source_type, source_id,
          base_amount, fee_method, fee_percent, fee_fixed, fee_refunded, refund_charge, amount,
          bank_account_id, fee_date, created_by)
       VALUES ($1, $2, $3, $4, 'refund', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (kind, source_type, source_id, invoice_payment_id) DO NOTHING
       RETURNING id`,
      [invoiceId, c.invoice_payment_id, c.provider_id, c.provider_name, sourceType, sourceId, portion,
        c.refund_charge_method, c.refund_charge_percent, c.refund_charge_fixed, Math.max(0, feeBack), charge, amount,
        c.bank_account_id, date, userId],
    );
    if (!row) continue;
    net = money(net + amount);
    await postFeeMovement(client, {
      feeRowId: row.id, amount, bankAccountId: c.bank_account_id, date, userId,
      description: `Card fee on refund (${c.provider_name}) for ${label}`,
    });
  }
  return net;
}

// Fee events of one invoice, for its detail screen.
async function feesForInvoice(invoiceId) {
  const { rows } = await query(
    `SELECT id, invoice_payment_id, provider_name, kind, source_type, base_amount::float8 AS base_amount,
            fee_method, fee_percent::float8 AS fee_percent, fee_fixed::float8 AS fee_fixed,
            fee_amount::float8 AS fee_amount, fee_refunded::float8 AS fee_refunded,
            refund_charge::float8 AS refund_charge, amount::float8 AS amount, fee_date, created_at
       FROM payment_fees WHERE invoice_id = $1 ORDER BY created_at, id`,
    [invoiceId],
  );
  return rows;
}

module.exports = {
  computeFee,
  listProviders,
  createProvider,
  updateProvider,
  recordSaleFees,
  recordRefundFees,
  feesForInvoice,
};
