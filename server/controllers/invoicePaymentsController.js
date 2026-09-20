const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  recalculateAndPersistTotals,
} = require('../services/invoiceService');

const createSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  method: z.enum(['cash', 'bank', 'credit']),
  amount: z.number().finite().positive().multipleOf(0.01),
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

// Record a draft allocation. Confirmation posts its financial effects.
async function create(req, res, next) {
  try {
    const { id: invoiceId } = req.params;
    const body = createSchema.parse({
      ...req.body,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
    });

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
      const { rows: existing } = await client.query(
        `SELECT * FROM invoice_payments WHERE invoice_id = $1 AND idempotency_key = $2`,
        [invoiceId, body.idempotencyKey],
      );
      if (existing.length) {
        const payment = existing[0];
        if (payment.method !== body.method || Number(payment.amount) !== body.amount ||
            (payment.bank_account_id || null) !== (body.bankAccountId || null) ||
            (payment.notes || null) !== (body.notes || null)) {
          throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
            'This payment key was already used with different payment details.', { status: 409 });
        }
        return { payment, invoice: inv, replayed: true };
      }
      // Confirmed invoices are fully allocated (cash/bank/credit). Collections
      // against credit belong to customer payments, not a second sale payment.
      if (inv.status !== 'draft') {
        throw new AppError(
          ERROR_CODES.BIZ_INVOICE_LOCKED,
          'Payments can only be added to a draft invoice. Use customer collections for credit repayments.',
          { status: 409 },
        );
      }

      const totals = await recalculateAndPersistTotals(client, invoiceId);
      if (Math.round(body.amount * 100) > Math.round(totals.balanceDue * 100)) {
        throw new AppError(ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE,
          'Payment exceeds the invoice balance.', { status: 409 });
      }

      if (body.method === 'credit') {
        if (!inv.customer_id) {
          throw new AppError(ERROR_CODES.BIZ_GUEST_NO_CREDIT, undefined, {
            status: 409,
          });
        }
      }

      const { rows: insertRows } = await client.query(
        `INSERT INTO invoice_payments
           (invoice_id, method, amount, bank_account_id, employee_id, notes, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          invoiceId,
          body.method,
          body.amount,
          body.bankAccountId || null,
          req.user.id,
          body.notes || null,
          body.idempotencyKey,
        ],
      );

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

    if (result.replayed) return ok(res, shape(result.payment));

    await logActivity({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'invoice.payment_added',
      performedBy: req.user.id,
      newValue: { method: body.method, amount: body.amount },
    });

    return created(res, shape(result.payment));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create };
