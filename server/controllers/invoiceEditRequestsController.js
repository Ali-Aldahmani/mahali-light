const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  applyEditRequest,
  rejectEditRequest,
} = require('../services/invoiceService');

const createSchema = z.object({
  requestNote: z.string().min(1).max(2000),
  changes: z
    .object({
      items: z
        .array(
          z.object({
            variant_id: z.string().uuid(),
            quantity: z.number().nonnegative(),
            unit_price: z.number().nonnegative().optional(),
            discount_amount: z.number().nonnegative().optional(),
          }),
        )
        .optional(),
      invoiceDiscount: z.number().nonnegative().optional(),
      notes: z.string().max(2000).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: 'Provide at least one change.',
    }),
});

function shape(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    customerName: row.customer_name,
    requestedBy: row.requested_by,
    requestedByUsername: row.requested_by_username,
    requestedAt: row.requested_at,
    requestNote: row.request_note,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedByUsername: row.reviewed_by_username,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    changes: row.changes,
  };
}

const EDIT_REQUEST_SELECT = `
  SELECT r.*,
         i.invoice_number,
         c.name AS customer_name,
         u1.username AS requested_by_username,
         u2.username AS reviewed_by_username
    FROM invoice_edit_requests r
    JOIN invoices i ON i.id = r.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN users u1 ON u1.id = r.requested_by
    LEFT JOIN users u2 ON u2.id = r.reviewed_by
`;

// List ALL edit requests, with optional status filter. Used by the manager
// review page. The /pending route is just /api/invoice-edit-requests?status=pending.
async function listAll(req, res, next) {
  try {
    const params = [];
    let where = '';
    if (req.query.status) {
      params.push(req.query.status);
      where = `WHERE r.status = $${params.length}`;
    }
    const { rows } = await query(
      `${EDIT_REQUEST_SELECT} ${where} ORDER BY r.requested_at DESC`,
      params,
    );
    const total = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending FROM invoice_edit_requests`,
    );
    return ok(res, rows.map(shape), {
      totals: { pending: total.rows[0].pending },
    });
  } catch (err) {
    next(err);
  }
}

async function listForInvoice(req, res, next) {
  try {
    const { rows } = await query(
      `${EDIT_REQUEST_SELECT}
        WHERE r.invoice_id = $1
        ORDER BY r.requested_at DESC`,
      [req.params.id],
    );
    return ok(res, rows.map(shape));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { id: invoiceId } = req.params;
    const body = createSchema.parse(req.body || {});

    const { rows: invRows } = await query(
      `SELECT status, has_return FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!invRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    if (invRows[0].has_return) {
      throw new AppError(
        ERROR_CODES.BIZ_INVOICE_LOCKED,
        'Invoice has a return; cannot request edits.',
        { status: 409 },
      );
    }

    const { rows } = await query(
      `INSERT INTO invoice_edit_requests
         (invoice_id, requested_by, request_note, changes)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [invoiceId, req.user.id, body.requestNote, JSON.stringify(body.changes)],
    );

    await query(
      `INSERT INTO invoice_history (invoice_id, action, performed_by, new_snapshot, notes)
       VALUES ($1, 'edit_requested', $2, $3::jsonb, $4)`,
      [invoiceId, req.user.id, JSON.stringify(body.changes), body.requestNote],
    );

    await logActivity({
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'invoice.edit_requested',
      performedBy: req.user.id,
      notes: body.requestNote,
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        requestId: rows[0].id,
        invoiceId,
        requestedBy: req.user.id,
        requestedByUsername: req.user.username,
        note: body.requestNote,
        at: new Date().toISOString(),
      };
      io.to('role:Manager').emit('edit_request_created', payload);
      io.to('role:Admin').emit('edit_request_created', payload);
    }

    const { rows: full } = await query(
      `${EDIT_REQUEST_SELECT} WHERE r.id = $1`,
      [rows[0].id],
    );
    return created(res, shape(full[0]));
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const { reqId } = req.params;
    const io = req.app.get('io');
    await applyEditRequest({
      requestId: reqId,
      managerId: req.user.id,
      io,
    });
    const { rows } = await query(
      `${EDIT_REQUEST_SELECT} WHERE r.id = $1`,
      [reqId],
    );
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const { reqId } = req.params;
    const reason = (req.body?.reason || '').toString().trim();
    if (!reason) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Rejection reason is required.',
        { status: 400 },
      );
    }
    const io = req.app.get('io');
    await rejectEditRequest({
      requestId: reqId,
      managerId: req.user.id,
      reason,
      io,
    });
    const { rows } = await query(
      `${EDIT_REQUEST_SELECT} WHERE r.id = $1`,
      [reqId],
    );
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

module.exports = { listAll, listForInvoice, create, approve, reject };
