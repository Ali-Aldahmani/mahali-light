const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { emitCustomerChanged } = require('../utils/customerEvents');
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

// Default: live balance collections (the list the Void action works on).
// ?include=all adds voided collections and the money taken at checkout on
// this customer's invoices (credit excluded: that is debt, not payment), so
// the profile shows every payment the customer made. Each row says where it
// came from in `source`.
async function listForCustomer(req, res, next) {
  try {
    const customerId = req.params.id;
    const { rows } = await query(
      `${PAYMENT_SELECT}
        WHERE p.customer_id = $1
        ORDER BY p.payment_date DESC, p.created_at DESC`,
      [customerId],
    );
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const totals = { totalCollected: Math.round(total * 100) / 100 };
    let data = rows.map((r) => ({ ...shape(r), source: 'balance' }));

    if (req.query.include === 'all') {
      const { rows: voided } = await query(
        `SELECT v.*, u.username AS employee_username, vu.username AS voided_by_username
           FROM customer_payment_voids v
           LEFT JOIN users u ON u.id = v.employee_id
           LEFT JOIN users vu ON vu.id = v.voided_by
          WHERE v.customer_id = $1`,
        [customerId],
      );
      const { rows: checkout } = await query(
        `SELECT ip.id, ip.invoice_id, ip.amount, ip.method, ip.bank_account_id,
                ip.timestamp, ip.employee_id, ip.notes, i.invoice_number,
                u.username AS employee_username
           FROM invoice_payments ip
           JOIN invoices i ON i.id = ip.invoice_id
           LEFT JOIN users u ON u.id = ip.employee_id
          WHERE i.customer_id = $1
            AND i.status NOT IN ('cancelled', 'draft')
            AND ip.method <> 'credit'`,
        [customerId],
      );
      const checkoutTotal = checkout.reduce((s, r) => s + Number(r.amount || 0), 0);
      totals.totalCheckout = Math.round(checkoutTotal * 100) / 100;
      data = [
        ...data,
        ...voided.map((r) => ({
          ...shape(r),
          source: 'balance',
          voidedAt: r.voided_at,
          voidedByUsername: r.voided_by_username || null,
        })),
        ...checkout.map((r) => ({
          id: r.id,
          customerId,
          invoiceId: r.invoice_id,
          invoiceNumber: r.invoice_number,
          amount: Number(r.amount),
          paymentMethod: r.method,
          paymentDate: r.timestamp,
          bankAccountId: r.bank_account_id,
          employeeId: r.employee_id,
          employeeUsername: r.employee_username,
          notes: r.notes,
          createdAt: r.timestamp,
          source: 'invoice',
        })),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return ok(res, data, { totals });
  } catch (err) {
    next(err);
  }
}

async function createForCustomer(req, res, next) {
  try {
    const { id: customerId } = req.params;
    const body = createSchema.parse(req.body || {});

    const { payment, customer, treasury } = await collectPayment({
      customerId,
      amount: body.amount,
      method: body.paymentMethod,
      paymentDate: body.paymentDate || null,
      bankAccountId: body.bankAccountId || null,
      notes: body.notes || null,
      employeeId: req.user.id,
    });

    const io = req.app.get('io');
    emitCustomerChanged(io, customerId, 'payment_collected');
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
      if (treasury) {
        const at = new Date().toISOString();
        if (treasury.method === 'cash') {
          const p = {
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'customer_payment',
            changedBy: req.user.id,
            at,
          };
          io.to('role:Manager').emit('cash_balance_updated', p);
          io.to('role:Admin').emit('cash_balance_updated', p);
        } else if (treasury.method === 'bank_transfer') {
          const p = {
            bankAccountId: treasury.accountId,
            bankName: treasury.bankName,
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'customer_payment',
            changedBy: req.user.id,
            at,
          };
          io.to('role:Manager').emit('bank_balance_updated', p);
          io.to('role:Admin').emit('bank_balance_updated', p);
        }
      }
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

    const { payment, customer, treasury } = await voidPayment({
      paymentId: id,
      voidedBy: req.user.id,
    });

    const io = req.app.get('io');
    emitCustomerChanged(io, customer.id, 'payment_voided');
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
      if (treasury) {
        const at = new Date().toISOString();
        if (treasury.method === 'cash') {
          const p = {
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'customer_payment',
            changedBy: req.user.id,
            at,
          };
          io.to('role:Manager').emit('cash_balance_updated', p);
          io.to('role:Admin').emit('cash_balance_updated', p);
        } else if (treasury.method === 'bank_transfer') {
          const p = {
            bankAccountId: treasury.accountId,
            bankName: treasury.bankName,
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'customer_payment',
            changedBy: req.user.id,
            at,
          };
          io.to('role:Manager').emit('bank_balance_updated', p);
          io.to('role:Admin').emit('bank_balance_updated', p);
        }
      }
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
