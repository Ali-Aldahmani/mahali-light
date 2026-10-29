const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  recalculateAndPersistTotals,
  assertDraftOwner,
} = require('../services/invoiceService');

// Sales audit SI-03: card and bank transfer are separate tenders, and both
// name the bank account the money goes to (no silent default account). They
// are stored as method 'bank' with tender 'card' / 'transfer', so reports and
// reversals that read method keep working. 'bank' alone is still accepted
// from older screens, but also needs an account now.
const BANK_TENDERS = { card: 'card', transfer: 'transfer', bank: null };

const createSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  method: z.enum(['cash', 'card', 'transfer', 'bank', 'credit']),
  amount: z.number().finite().positive().multipleOf(0.01),
  bankAccountId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// The stored form of a requested payment.
function storedPayment(body) {
  const isBank = Object.prototype.hasOwnProperty.call(BANK_TENDERS, body.method);
  return {
    method: isBank ? 'bank' : body.method,
    tender: isBank ? BANK_TENDERS[body.method] : null,
    bankAccountId: isBank ? body.bankAccountId || null : null,
    reference: isBank ? body.reference || null : null,
  };
}

async function assertActiveBankAccount(client, bankAccountId) {
  if (!bankAccountId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      'Choose the bank account for this card or transfer payment.',
      { status: 400, details: { field: 'bankAccountId' } });
  }
  const { rows } = await client.query(
    `SELECT 1 FROM bank_accounts WHERE id = $1 AND is_active = true`, [bankAccountId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      'That bank account is closed or does not exist.',
      { status: 400, details: { field: 'bankAccountId' } });
  }
}

const TENDER_LABELS = { card: 'card', transfer: 'bank transfer' };

function shape(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    method: row.method,
    // 'card' or 'transfer' for bank payments taken from now on.
    tender: row.tender || null,
    reference: row.reference || null,
    amount: Number(row.amount),
    bankAccountId: row.bank_account_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username || null,
    timestamp: row.timestamp,
    notes: row.notes,
    // The key the screen sent it with, so a resumed sale reuses it and a
    // retry can't record the allocation twice.
    idempotencyKey: row.idempotency_key || null,
  };
}

// Changing a draft's payments recalculates its totals, which moves its
// updatedAt. The screen sends that back as expectedUpdatedAt on its next save
// (invoice audit F23), so it needs the new value, or a retry after a refused
// confirm (closed drawer, stock) would look like an edit from another screen.
async function draftVersion(client, invoiceId) {
  const { rows } = await client.query(`SELECT updated_at FROM invoices WHERE id = $1`, [invoiceId]);
  return rows[0].updated_at;
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
    const pay = storedPayment(body);

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
        if (payment.method !== pay.method || Number(payment.amount) !== body.amount ||
            (payment.bank_account_id || null) !== pay.bankAccountId ||
            (payment.tender || null) !== pay.tender ||
            (payment.reference || null) !== pay.reference ||
            (payment.notes || null) !== (body.notes || null)) {
          throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
            'This payment key was already used with different payment details.', { status: 409 });
        }
        return { payment, invoice: inv, invoiceUpdatedAt: inv.updated_at, replayed: true };
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
      await assertDraftOwner(client, inv, req.user.id);

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
      if (pay.method === 'bank') await assertActiveBankAccount(client, pay.bankAccountId);

      const { rows: insertRows } = await client.query(
        `INSERT INTO invoice_payments
           (invoice_id, method, amount, bank_account_id, employee_id, notes, idempotency_key,
            tender, reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          invoiceId,
          pay.method,
          body.amount,
          pay.bankAccountId,
          req.user.id,
          body.notes || null,
          body.idempotencyKey,
          pay.tender,
          pay.reference,
        ],
      );

      await recalculateAndPersistTotals(client, invoiceId);
      const invoiceUpdatedAt = await draftVersion(client, invoiceId);

      await client.query(
        `INSERT INTO invoice_history (invoice_id, action, performed_by, new_snapshot, notes)
         VALUES ($1, 'payment_added', $2, $3::jsonb, $4)`,
        [
          invoiceId,
          req.user.id,
          JSON.stringify({ method: pay.method, tender: pay.tender, amount: body.amount }),
          `+${Number(body.amount).toFixed(2)} via ${TENDER_LABELS[pay.tender] || pay.method}`,
        ],
      );

      const { rows: full } = await client.query(
        `SELECT p.*, u.username AS employee_username
           FROM invoice_payments p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1`,
        [insertRows[0].id],
      );
      return { payment: full[0], invoice: inv, invoiceUpdatedAt };
    });

    const payload = { ...shape(result.payment), invoiceUpdatedAt: result.invoiceUpdatedAt };
    if (result.replayed) return ok(res, payload);

    await logActivity({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'invoice.payment_added',
      performedBy: req.user.id,
      newValue: { method: pay.method, tender: pay.tender, amount: body.amount },
    });

    return created(res, payload);
  } catch (err) {
    next(err);
  }
}

// Remove an allocation from a draft (invoice audit F14). A draft's
// allocations have no financial effect until the invoice is confirmed, so
// taking one off is safe; it is recorded in the invoice history. Lets a
// resumed or retried sale replace an allocation whose amount or method
// changed, instead of leaving the draft stuck.
async function remove(req, res, next) {
  try {
    const { id: invoiceId, paymentId } = req.params;
    const invoiceUpdatedAt = await withTransaction(async (client) => {
      const { rows: invRows } = await client.query(
        `SELECT status, owner_id FROM invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId],
      );
      if (!invRows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
      }
      if (invRows[0].status !== 'draft') {
        throw new AppError(
          ERROR_CODES.BIZ_INVOICE_LOCKED,
          'Payments can only be removed from a draft invoice.',
          { status: 409 },
        );
      }
      await assertDraftOwner(client, invRows[0], req.user.id);
      const { rows } = await client.query(
        `DELETE FROM invoice_payments WHERE id = $1 AND invoice_id = $2
         RETURNING method, amount`,
        [paymentId, invoiceId],
      );
      if (!rows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
      }
      await recalculateAndPersistTotals(client, invoiceId);
      await client.query(
        `INSERT INTO invoice_history (invoice_id, action, performed_by, old_snapshot, notes)
         VALUES ($1, 'payment_removed', $2, $3::jsonb, $4)`,
        [
          invoiceId,
          req.user.id,
          JSON.stringify({ method: rows[0].method, amount: Number(rows[0].amount) }),
          `-${Number(rows[0].amount).toFixed(2)} via ${rows[0].method}`,
        ],
      );
      await logActivity({
        client,
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'invoice.payment_removed',
        performedBy: req.user.id,
        oldValue: { method: rows[0].method, amount: Number(rows[0].amount) },
      });
      return draftVersion(client, invoiceId);
    });
    return ok(res, { removed: true, invoiceUpdatedAt });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, remove };
