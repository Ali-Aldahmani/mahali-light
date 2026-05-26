const { withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const cashService = require('./cashService');
const bankService = require('./bankService');

const VALID_METHODS = new Set(['cash', 'bank_transfer']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Collect a payment from a customer. Reduces their credit_balance and records
// a customer_payments row. Atomic — uses SELECT ... FOR UPDATE on the
// customer row to prevent two concurrent collections from over-draining the
// balance below zero.
async function collectPayment({
  customerId,
  amount,
  method,
  paymentDate,
  bankAccountId = null,
  notes = null,
  employeeId,
  invoiceId = null,
}) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Amount must be greater than zero.',
      { status: 400 },
    );
  }
  if (!VALID_METHODS.has(method)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid payment method. Use cash or bank_transfer.',
      { status: 400 },
    );
  }

  return withTransaction(async (client) => {
    const { rows: customerRows } = await client.query(
      `SELECT id, name, credit_balance, is_active
         FROM customers WHERE id = $1 FOR UPDATE`,
      [customerId],
    );
    if (!customerRows.length) {
      throw new AppError(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        'Customer not found.',
        { status: 404 },
      );
    }
    const customer = customerRows[0];
    if (!customer.is_active) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Customer is inactive.',
        { status: 409 },
      );
    }

    const balance = money(customer.credit_balance);
    if (amt - balance > 0.001) {
      throw new AppError(
        ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE,
        `Payment of ${amt.toFixed(2)} exceeds outstanding balance of ${balance.toFixed(2)}.`,
        { status: 409, details: { amount: amt, balance } },
      );
    }

    const { rows: paymentRows } = await client.query(
      `INSERT INTO customer_payments
         (customer_id, invoice_id, amount, payment_method, bank_account_id,
          payment_date, employee_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        customerId,
        invoiceId,
        amt,
        method,
        bankAccountId,
        paymentDate || new Date().toISOString().slice(0, 10),
        employeeId,
        notes,
      ],
    );
    const payment = paymentRows[0];

    const newBalance = money(balance - amt);

    await client.query(
      `UPDATE customers
          SET credit_balance = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [newBalance, customerId],
    );

    // Treasury bookkeeping: cash → drawer, bank_transfer → bank account.
    let treasury = null;
    if (method === 'cash') {
      treasury = await cashService.recordCashIn({
        client,
        transactionType: 'customer_payment',
        amount: amt,
        referenceType: 'customer_payment',
        referenceId: payment.id,
        employeeId,
        notes: `Collection from ${customer.name}`,
      });
    } else if (method === 'bank_transfer') {
      treasury = await bankService.recordBankIn({
        client,
        bankAccountId: bankAccountId || null,
        transactionType: 'customer_payment',
        amount: amt,
        referenceType: 'customer_payment',
        referenceId: payment.id,
        employeeId,
        description: `Collection from ${customer.name}`,
      });
    }

    return {
      payment,
      customer: {
        id: customer.id,
        name: customer.name,
        creditBalance: newBalance,
      },
      treasury: treasury
        ? {
            method,
            balanceAfter: treasury.balanceAfter,
            delta: treasury.delta,
            accountId: treasury.accountId || null,
            bankName: treasury.bankName || null,
          }
        : null,
    };
  });
}

// Same-day reversal of a customer payment. Restores credit_balance to its
// pre-payment value. Throws BIZ_INVALID_STATE when the payment is older than
// today.
async function voidPayment({ paymentId }) {
  return withTransaction(async (client) => {
    const { rows: pmRows } = await client.query(
      `SELECT * FROM customer_payments WHERE id = $1 FOR UPDATE`,
      [paymentId],
    );
    if (!pmRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const pm = pmRows[0];

    const today = new Date().toISOString().slice(0, 10);
    const createdDay = new Date(pm.created_at).toISOString().slice(0, 10);
    if (createdDay !== today) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Only payments created today can be voided.',
        { status: 409 },
      );
    }

    const { rows: customerRows } = await client.query(
      `SELECT id, name, credit_balance FROM customers WHERE id = $1 FOR UPDATE`,
      [pm.customer_id],
    );
    if (!customerRows.length) {
      throw new AppError(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        'Customer not found.',
        { status: 404 },
      );
    }
    const customer = customerRows[0];

    await client.query(`DELETE FROM customer_payments WHERE id = $1`, [
      paymentId,
    ]);

    const newBalance = money(money(customer.credit_balance) + money(pm.amount));

    await client.query(
      `UPDATE customers
          SET credit_balance = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [newBalance, customer.id],
    );

    // Reverse the original treasury posting so the running balance is
    // consistent. Cash payments must come back out of the drawer; bank
    // transfers come back out of the bank account they landed in.
    let treasury = null;
    const amount = money(pm.amount);
    if (amount > 0) {
      if (pm.payment_method === 'cash') {
        treasury = await cashService.recordCashOut({
          client,
          transactionType: 'customer_payment',
          amount,
          referenceType: 'customer_payment',
          referenceId: paymentId,
          employeeId: pm.employee_id,
          notes: 'Reversal of customer payment',
        });
      } else if (pm.payment_method === 'bank_transfer') {
        treasury = await bankService.recordBankOut({
          client,
          bankAccountId: pm.bank_account_id || null,
          transactionType: 'customer_payment',
          amount,
          referenceType: 'customer_payment',
          referenceId: paymentId,
          employeeId: pm.employee_id,
          description: 'Reversal of customer payment',
          allowOverdraft: true,
        });
      }
    }

    return {
      payment: pm,
      treasury: treasury
        ? {
            method: pm.payment_method,
            balanceAfter: treasury.balanceAfter,
            delta: treasury.delta,
            accountId: treasury.accountId || null,
            bankName: treasury.bankName || null,
          }
        : null,
      customer: {
        id: customer.id,
        name: customer.name,
        creditBalance: newBalance,
      },
    };
  });
}

// Helper used by Phase 6 invoicing — tests whether adding `addedCredit` to
// the customer's balance would exceed their credit_limit (0 means unlimited).
// Caller is responsible for the actual balance mutation.
async function assertWithinCreditLimit(client, customerId, addedCredit) {
  if (!customerId || !addedCredit || Number(addedCredit) <= 0) return;
  const { rows } = await client.query(
    `SELECT credit_balance, credit_limit, name
       FROM customers WHERE id = $1`,
    [customerId],
  );
  if (!rows.length) return;
  const limit = money(rows[0].credit_limit);
  if (limit <= 0) return; // unlimited
  const after = money(rows[0].credit_balance) + money(addedCredit);
  if (after - limit > 0.001) {
    throw new AppError(
      ERROR_CODES.BIZ_CREDIT_LIMIT_EXCEEDED,
      `Adding ${money(addedCredit).toFixed(2)} would exceed ${rows[0].name}'s credit limit of ${limit.toFixed(2)}.`,
      {
        status: 409,
        details: {
          limit,
          currentBalance: money(rows[0].credit_balance),
          addedCredit: money(addedCredit),
        },
      },
    );
  }
}

module.exports = { collectPayment, voidPayment, assertWithinCreditLimit };
