const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  recalculateAndPersistTotals,
} = require('../services/invoiceService');
const {
  assertWithinCreditLimit,
} = require('../services/customerService');

const createSchema = z.object({
  method: z.enum(['cash', 'bank', 'credit']),
  amount: z.number().positive(),
  bankAccountId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function shape(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    method: row.method,
    amount: Number(row.amount),
    bankAccountId: row.bank_account_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username || null,
    timestamp: row.timestamp,
    notes: row.notes,
  };
}

async function list(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.*, u.username AS employee_username
         FROM invoice_payments p
         LEFT JOIN users u ON u.id = p.employee_id
        WHERE p.invoice_id = $1
        ORDER BY timestamp ASC`,
      [req.params.id],
    );
    return ok(res, rows.map(shape));
  } catch (err) {
    next(err);
  }
}

// Add a payment to an invoice. For credit payments, validates that the
// customer exists and that the new charge stays within their credit limit.
// On confirmed invoices, the customer's credit_balance is updated immediately
// to reflect the additional credit charge. On drafts, credit is only applied
// at confirmation time so we just record the row.
async function create(req, res, next) {
  try {
    const { id: invoiceId } = req.params;
    const body = createSchema.parse(req.body || {});

    const result = await withTransaction(async (client) => {
      const { rows: invRows } = await client.query(
        `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId],
      );
      if (!invRows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
          status: 404,
        });
      }
      const inv = invRows[0];
      if (inv.status === 'cancelled') {
        throw new AppError(
          ERROR_CODES.BIZ_INVOICE_LOCKED,
          'Cannot add payments to a cancelled invoice.',
          { status: 409 },
        );
      }

      if (body.method === 'credit') {
        if (!inv.customer_id) {
          throw new AppError(ERROR_CODES.BIZ_GUEST_NO_CREDIT, undefined, {
            status: 409,
          });
        }
        if (inv.status === 'confirmed') {
          await assertWithinCreditLimit(client, inv.customer_id, body.amount);
        }
      }

      const { rows: insertRows } = await client.query(
        `INSERT INTO invoice_payments
           (invoice_id, method, amount, bank_account_id, employee_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [
          invoiceId,
          body.method,
          body.amount,
          body.bankAccountId || null,
          req.user.id,
          body.notes || null,
        ],
      );

      // For confirmed invoices, apply credit-balance side-effects right away.
      if (inv.status === 'confirmed' && body.method === 'credit') {
        await client.query(
          `UPDATE customers
              SET credit_balance = credit_balance + $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [body.amount, inv.customer_id],
        );
      }

      await recalculateAndPersistTotals(client, invoiceId);

      await client.query(
        `INSERT INTO invoice_history (invoice_id, action, performed_by, new_snapshot, notes)
         VALUES ($1, 'payment_added', $2, $3::jsonb, $4)`,
        [
          invoiceId,
          req.user.id,
          JSON.stringify({ method: body.method, amount: body.amount }),
          `+${Number(body.amount).toFixed(2)} via ${body.method}`,
        ],
      );

      const { rows: full } = await client.query(
        `SELECT p.*, u.username AS employee_username
           FROM invoice_payments p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1`,
        [insertRows[0].id],
      );
      return { payment: full[0], invoice: inv };
    });

    await logActivity({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'invoice.payment_added',
      performedBy: req.user.id,
      newValue: { method: body.method, amount: body.amount },
    });

    const io = req.app.get('io');
    if (io && result.invoice.customer_id && body.method === 'credit' && result.invoice.status === 'confirmed') {
      const { rows: cRows } = await query(
        `SELECT name, credit_balance FROM customers WHERE id = $1`,
        [result.invoice.customer_id],
      );
      if (cRows.length) {
        const payload = {
          customerId: result.invoice.customer_id,
          customerName: cRows[0].name,
          newBalance: Number(cRows[0].credit_balance),
          deltaAmount: Number(body.amount),
          method: 'invoice_credit',
          changedBy: req.user.id,
          at: new Date().toISOString(),
        };
        io.to('role:Manager').emit('customer_balance_updated', payload);
        io.to('role:Admin').emit('customer_balance_updated', payload);
      }
    }

    return created(res, shape(result.payment));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create };
