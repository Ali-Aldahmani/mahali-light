const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  collectPayment,
  voidPayment,
} = require('../services/customerService');

const createSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank_transfer']),
  paymentDate: z.string().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function shape(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    invoiceId: row.invoice_id,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    bankAccountId: row.bank_account_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

const PAYMENT_SELECT = `
  SELECT p.*, u.username AS employee_username
    FROM customer_payments p
    LEFT JOIN users u ON u.id = p.employee_id
`;

async function listForCustomer(req, res, next) {
  try {
    const { rows } = await query(
      `${PAYMENT_SELECT}
        WHERE p.customer_id = $1
        ORDER BY p.payment_date DESC, p.created_at DESC`,
      [req.params.id],
    );
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    return ok(res, rows.map(shape), {
      totals: { totalCollected: Math.round(total * 100) / 100 },
    });
  } catch (err) {
    next(err);
  }
}

async function createForCustomer(req, res, next) {
  try {
    const { id: customerId } = req.params;
    const body = createSchema.parse(req.body || {});

    const { payment, customer } = await collectPayment({
      customerId,
      amount: body.amount,
      method: body.paymentMethod,
      paymentDate: body.paymentDate || null,
      bankAccountId: body.bankAccountId || null,
      notes: body.notes || null,
      employeeId: req.user.id,
    });

    await logActivity({
      entityType: 'customer',
      entityId: customerId,
      action: 'customer.payment_collected',
      performedBy: req.user.id,
      notes: `${Number(payment.amount).toFixed(2)} AED via ${payment.payment_method}`,
      newValue: { creditBalance: customer.creditBalance },
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        customerId: customer.id,
        customerName: customer.name,
        newBalance: customer.creditBalance,
        deltaAmount: -Number(payment.amount),
        method: payment.payment_method,
        changedBy: req.user.id,
        changedByUsername: req.user.username,
        at: new Date().toISOString(),
      };
      io.to('role:Manager').emit('customer_balance_updated', payload);
      io.to('role:Admin').emit('customer_balance_updated', payload);
    }

    const { rows } = await query(`${PAYMENT_SELECT} WHERE p.id = $1`, [
      payment.id,
    ]);

    return created(res, {
      payment: shape(rows[0]),
      customer,
    });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;

    const { rows: existing } = await query(
      `SELECT id, amount, customer_id FROM customer_payments WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }

    const { payment, customer } = await voidPayment({ paymentId: id });

    await logActivity({
      entityType: 'customer',
      entityId: customer.id,
      action: 'customer.payment_voided',
      performedBy: req.user.id,
      notes: `Reversed ${Number(payment.amount).toFixed(2)} AED`,
      newValue: { creditBalance: customer.creditBalance },
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        customerId: customer.id,
        customerName: customer.name,
        newBalance: customer.creditBalance,
        deltaAmount: Number(payment.amount),
        method: payment.payment_method,
        reversed: true,
        changedBy: req.user.id,
        changedByUsername: req.user.username,
        at: new Date().toISOString(),
      };
      io.to('role:Manager').emit('customer_balance_updated', payload);
      io.to('role:Admin').emit('customer_balance_updated', payload);
    }

    return ok(res, {
      id,
      customer,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listForCustomer, createForCustomer, remove };
