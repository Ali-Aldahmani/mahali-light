const { withTransaction } = require('../db/postgres');
const journalService = require('./journalService');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const cashService = require('./cashService');
const bankService = require('./bankService');

const VALID_METHODS = new Set(['cash', 'bank_transfer', 'cheque']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computePaymentStatus(totalCost, amountPaid) {
  const bal = money(totalCost) - money(amountPaid);
  if (bal <= 0.0001) return 'paid';
  if (amountPaid > 0) return 'partial';
  return 'unpaid';
}

// Add a payment to a purchase order, atomically updating the PO totals.
// Returns the inserted payment + the refreshed PO.
async function addPayment({
  poId,
  amount,
  method,
  paymentDate,
  bankAccountId = null,
  receiptAttachment = null,
  notes = null,
  employeeId,
}) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Amount must be greater than zero.', {
      status: 400,
    });
  }
  if (!VALID_METHODS.has(method)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid payment method.', {
      status: 400,
    });
  }

  return withTransaction(async (client) => {
    const { rows: poRows } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [poId],
    );
    if (!poRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Purchase order not found.', {
        status: 404,
      });
    }
    const po = poRows[0];

    if (po.status === 'cancelled') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Cannot add a payment to a cancelled PO.',
        { status: 409 },
      );
    }

    const totalCost = money(po.total_cost);
    const alreadyPaid = money(po.amount_paid);
    const balance = money(totalCost - alreadyPaid);

    if (amt - balance > 0.001) {
      throw new AppError(
        ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE,
        `Payment of ${amt.toFixed(2)} exceeds outstanding balance of ${balance.toFixed(2)}.`,
        { status: 409, details: { amount: amt, balance } },
      );
    }

    const { rows: paymentRows } = await client.query(
      `INSERT INTO supplier_payments
         (purchase_order_id, supplier_id, amount, payment_method, bank_account_id,
          payment_date, employee_id, receipt_attachment, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        poId,
        po.supplier_id,
        amt,
        method,
        bankAccountId,
        paymentDate || new Date().toISOString().slice(0, 10),
        employeeId,
        receiptAttachment,
        notes,
      ],
    );
    const payment = paymentRows[0];

    const newPaid = money(alreadyPaid + amt);
    const newBalance = money(totalCost - newPaid);
    const newStatus = computePaymentStatus(totalCost, newPaid);

    await client.query(
      `UPDATE purchase_orders
          SET amount_paid = $1,
              balance_due = $2,
              payment_status = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [newPaid, newBalance, newStatus, poId],
    );

    const { rows: refreshed } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1`,
      [poId],
    );

    // Treasury bookkeeping. Cheques are tracked but don't move money until
    // they clear, so we only post for cash + bank_transfer.
    let treasury = null;
    if (method === 'cash') {
      treasury = await cashService.recordCashOut({
        client,
        transactionType: 'supplier_payment',
        amount: amt,
        referenceType: 'purchase_order',
        referenceId: poId,
        employeeId,
        notes: `Payment to supplier on ${po.po_number || po.id}`,
      });
    } else if (method === 'bank_transfer') {
      treasury = await bankService.recordBankOut({
        client,
        bankAccountId: bankAccountId || null,
        transactionType: 'supplier_payment',
        amount: amt,
        referenceType: 'purchase_order',
        referenceId: poId,
        employeeId,
        description: `Payment to supplier on ${po.po_number || po.id}`,
        allowOverdraft: true,
      });
    }

    // Cheques are tracked but don't move money until cleared, so no journal
    // entry yet for cheque method. Cash + bank transfers post immediately.
    if (method === 'cash' || method === 'bank_transfer') {
      await journalService.postSupplierPaymentEntry(client, {
        paymentId: payment.id,
        amount: amt,
        method: method === 'cash' ? 'cash' : 'bank',
        poNumber: po.po_number,
        date: payment.payment_date,
        userId: employeeId,
      });
    }

    return {
      payment,
      po: refreshed[0],
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

// Delete a payment but only if it was created today. Reverses the PO totals.
async function deletePayment({ paymentId }) {
  return withTransaction(async (client) => {
    const { rows: pmRows } = await client.query(
      `SELECT * FROM supplier_payments WHERE id = $1 FOR UPDATE`,
      [paymentId],
    );
    if (!pmRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const pm = pmRows[0];

    const today = new Date().toISOString().slice(0, 10);
    const createdDay = new Date(pm.created_at).toISOString().slice(0, 10);
    if (createdDay !== today) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Only payments created today can be deleted.',
        { status: 409 },
      );
    }

    const { rows: poRows } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [pm.purchase_order_id],
    );
    if (!poRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Purchase order not found.', {
        status: 404,
      });
    }
    const po = poRows[0];

    await client.query(`DELETE FROM supplier_payments WHERE id = $1`, [paymentId]);

    const totalCost = money(po.total_cost);
    const newPaid = money(money(po.amount_paid) - money(pm.amount));
    const newBalance = money(totalCost - newPaid);
    const newStatus = computePaymentStatus(totalCost, newPaid);

    await client.query(
      `UPDATE purchase_orders
          SET amount_paid = $1,
              balance_due = $2,
              payment_status = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [newPaid, newBalance, newStatus, po.id],
    );

    const { rows: refreshed } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1`,
      [po.id],
    );

    // Reverse the original treasury posting (cash + bank only).
    let treasury = null;
    const amount = money(pm.amount);
    if (amount > 0) {
      if (pm.payment_method === 'cash') {
        treasury = await cashService.recordCashIn({
          client,
          transactionType: 'supplier_payment',
          amount,
          referenceType: 'purchase_order',
          referenceId: po.id,
          employeeId: pm.employee_id,
          notes: `Reversal of supplier payment ${paymentId}`,
        });
      } else if (pm.payment_method === 'bank_transfer') {
        treasury = await bankService.recordBankIn({
          client,
          bankAccountId: pm.bank_account_id || null,
          transactionType: 'supplier_payment',
          amount,
          referenceType: 'purchase_order',
          referenceId: po.id,
          employeeId: pm.employee_id,
          description: `Reversal of supplier payment`,
        });
      }
    }

    return {
      payment: pm,
      po: refreshed[0],
      treasury: treasury
        ? {
            method: pm.payment_method,
            balanceAfter: treasury.balanceAfter,
            delta: treasury.delta,
            accountId: treasury.accountId || null,
            bankName: treasury.bankName || null,
          }
        : null,
    };
  });
}

module.exports = { addPayment, deletePayment, computePaymentStatus };
