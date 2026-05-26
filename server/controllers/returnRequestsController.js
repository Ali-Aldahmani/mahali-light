const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const returnService = require('../services/returnService');

const REQUEST_SELECT = `
  SELECT r.*,
         c.name AS customer_name, c.phone AS customer_phone,
         s.name AS supplier_name,
         i.invoice_number AS invoice_number,
         u.username AS requested_by_username,
         rv.username AS reviewed_by_username,
         ap.username AS approved_by_username,
         (SELECT COUNT(*)::int FROM return_request_items ri WHERE ri.return_request_id = r.id) AS item_count,
         (SELECT COALESCE(SUM(ri.total_value),0) FROM return_request_items ri WHERE ri.return_request_id = r.id) AS total_value
    FROM return_requests r
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN suppliers s ON s.id = r.supplier_id
    LEFT JOIN invoices i ON i.id = r.reference_id AND r.reference_type = 'invoice'
    LEFT JOIN users u ON u.id = r.requested_by
    LEFT JOIN users rv ON rv.id = r.reviewed_by
    LEFT JOIN users ap ON ap.id = r.approved_by
`;

function shapeRequest(row, extra = {}) {
  if (!row) return null;
  let refundPlan = row.refund_plan;
  let replacementPlan = row.replacement_plan;
  if (typeof refundPlan === 'string') {
    try { refundPlan = JSON.parse(refundPlan); } catch (_e) { refundPlan = null; }
  }
  if (typeof replacementPlan === 'string') {
    try { replacementPlan = JSON.parse(replacementPlan); } catch (_e) { replacementPlan = null; }
  }
  return {
    id: row.id,
    requestNumber: row.request_number,
    returnType: row.return_type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    invoiceNumber: row.invoice_number || null,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || null,
    noInvoiceReturn: row.no_invoice_return,
    approvedBy: row.approved_by,
    approvedByUsername: row.approved_by_username || null,
    reason: row.reason,
    requestNote: row.request_note,
    requestedBy: row.requested_by,
    requestedByUsername: row.requested_by_username || null,
    requestedAt: row.requested_at,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedByUsername: row.reviewed_by_username || null,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    executedAt: row.executed_at,
    executedBy: row.executed_by,
    notes: row.notes,
    refundPlan,
    replacementPlan,
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
    totalValue: row.total_value != null ? Number(row.total_value) : undefined,
    ...extra,
  };
}

function shapeItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    invoiceItemId: row.invoice_item_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    unitLabel: row.unit_label,
    unitPrice: Number(row.unit_price),
    totalValue: Number(row.total_value),
    condition: row.condition,
    serialNumber: row.serial_number,
    warrantyId: row.warranty_id,
  };
}

function buildListFilters(req, currentUser) {
  const parts = [];
  const params = [];
  let i = 1;

  if (req.query.status) {
    parts.push(`r.status = $${i++}`);
    params.push(req.query.status);
  }
  if (req.query.return_type) {
    parts.push(`r.return_type = $${i++}`);
    params.push(req.query.return_type);
  }
  if (req.query.customer_id) {
    parts.push(`r.customer_id = $${i++}`);
    params.push(req.query.customer_id);
  }
  if (req.query.supplier_id) {
    parts.push(`r.supplier_id = $${i++}`);
    params.push(req.query.supplier_id);
  }
  if (req.query.requested_by) {
    parts.push(`r.requested_by = $${i++}`);
    params.push(req.query.requested_by);
  }
  if (req.query.from) {
    parts.push(`r.requested_at >= $${i++}`);
    params.push(req.query.from);
  }
  if (req.query.to) {
    parts.push(`r.requested_at <= $${i++}`);
    params.push(req.query.to);
  }
  if (req.query.search) {
    parts.push(
      `(r.request_number ILIKE $${i} OR c.name ILIKE $${i}
        OR c.phone ILIKE $${i} OR s.name ILIKE $${i}
        OR i.invoice_number ILIKE $${i})`,
    );
    params.push(`%${req.query.search}%`);
    i++;
  }

  // Cashiers can only see their own requests unless they have approval rights.
  const canSeeAll =
    (currentUser?.permissions || []).includes('return.approve') ||
    (currentUser?.permissions || []).includes('*');
  if (!canSeeAll && currentUser?.id) {
    parts.push(`r.requested_by = $${i++}`);
    params.push(currentUser.id);
  }
  return { where: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

async function list(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { where, params } = buildListFilters(req, req.user);

    const { rows } = await query(
      `${REQUEST_SELECT} ${where}
         ORDER BY r.requested_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total FROM return_requests r
         LEFT JOIN customers c ON c.id = r.customer_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id
         LEFT JOIN invoices i ON i.id = r.reference_id AND r.reference_type = 'invoice'
         ${where}`,
      params,
    );
    return ok(res, rows.map((r) => shapeRequest(r)), {
      total: totals[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

async function summary(req, res, next) {
  try {
    const canApprove =
      (req.user?.permissions || []).includes('return.approve') ||
      (req.user?.permissions || []).includes('*');

    const params = [];
    let whereOwn = '';
    if (!canApprove) {
      whereOwn = ' AND requested_by = $1';
      params.push(req.user.id);
    }

    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending'${whereOwn})::int AS pending_count,
         COUNT(*) FILTER (WHERE status = 'approved'
                          AND reviewed_at >= date_trunc('month', CURRENT_DATE)
                          ${whereOwn})::int AS approved_this_month,
         COUNT(*) FILTER (WHERE status = 'rejected'${whereOwn})::int AS rejected_count,
         COUNT(*) FILTER (WHERE no_invoice_return = true
                          AND status = 'pending'${whereOwn})::int AS pending_no_invoice
         FROM return_requests`,
      params,
    );
    return ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${REQUEST_SELECT} WHERE r.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const canApprove =
      (req.user?.permissions || []).includes('return.approve') ||
      (req.user?.permissions || []).includes('*');
    if (!canApprove && rows[0].requested_by !== req.user.id) {
      throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, { status: 403 });
    }

    const { rows: items } = await query(
      `SELECT * FROM return_request_items WHERE return_request_id = $1
        ORDER BY id ASC`,
      [req.params.id],
    );
    const { rows: history } = await query(
      `SELECT h.*, u.username AS performed_by_username
         FROM return_request_history h
         LEFT JOIN users u ON u.id = h.performed_by
        WHERE h.return_request_id = $1
        ORDER BY h.timestamp ASC`,
      [req.params.id],
    );

    // If executed, also surface the resulting return_order summary.
    let order = null;
    const { rows: orderRows } = await query(
      `SELECT id, return_order_number, total_value, refund_total,
              replacement_invoice_id, created_at
         FROM return_orders WHERE return_request_id = $1
         ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (orderRows.length) {
      order = {
        id: orderRows[0].id,
        returnOrderNumber: orderRows[0].return_order_number,
        totalValue: Number(orderRows[0].total_value),
        refundTotal: Number(orderRows[0].refund_total),
        replacementInvoiceId: orderRows[0].replacement_invoice_id,
        createdAt: orderRows[0].created_at,
      };
    }

    return ok(res, {
      ...shapeRequest(rows[0]),
      items: items.map(shapeItem),
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        performedBy: h.performed_by,
        performedByUsername: h.performed_by_username,
        timestamp: h.timestamp,
        oldStatus: h.old_status,
        newStatus: h.new_status,
        notes: h.notes,
      })),
      order,
    });
  } catch (err) {
    next(err);
  }
}

const itemSchema = z.object({
  invoiceItemId: z.string().uuid().optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  variantId: z.string().uuid().optional().nullable(),
  productName: z.string().max(200).optional().nullable(),
  unitLabel: z.string().max(20).optional().nullable(),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().positive(),
  condition: z.enum(['good', 'defective', 'damaged']),
  serialNumber: z.string().max(100).optional().nullable(),
  warrantyId: z.string().uuid().optional().nullable(),
});

const refundPlanSchema = z
  .array(
    z.object({
      method: z.enum(['cash', 'bank', 'credit']),
      amount: z.number().positive(),
      bankAccountId: z.string().uuid().optional().nullable(),
      notes: z.string().max(500).optional().nullable(),
    }),
  )
  .optional()
  .nullable();

const replacementPlanSchema = z
  .object({
    items: z.array(
      z.object({
        variantId: z.string().uuid(),
        productId: z.string().uuid().optional().nullable(),
        productName: z.string().max(200).optional().nullable(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    ),
    priceDifference: z.number().optional().nullable(),
    differenceDirection: z
      .enum(['none', 'customer_pays', 'refund_to_customer'])
      .optional()
      .nullable(),
  })
  .optional()
  .nullable();

const createSchema = z.object({
  returnType: z.enum(['customer_refund', 'customer_replace', 'supplier_return']),
  referenceType: z.enum(['invoice', 'purchase_order', 'manual']).optional().default('invoice'),
  referenceId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  noInvoiceReturn: z.boolean().optional().default(false),
  approvedBy: z.string().uuid().optional().nullable(),
  reason: z.enum([
    'defective',
    'wrong_item',
    'excess_stock',
    'customer_request',
    'expired',
    'other',
  ]),
  requestNote: z.string().min(10).max(2000),
  items: z.array(itemSchema).min(1),
  refundPlan: refundPlanSchema,
  replacementPlan: replacementPlanSchema,
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await returnService.createReturnRequest({
      ...body,
      requestedBy: req.user.id,
      io,
    });
    const { rows } = await query(`${REQUEST_SELECT} WHERE r.id = $1`, [
      result.request.id,
    ]);
    return created(res, shapeRequest(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid return payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const io = req.app.get('io');
    await returnService.approveAndExecute({
      requestId: req.params.id,
      managerId: req.user.id,
      notes: req.body?.notes || null,
      io,
    });
    const { rows } = await query(`${REQUEST_SELECT} WHERE r.id = $1`, [req.params.id]);
    return ok(res, shapeRequest(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const io = req.app.get('io');
    await returnService.rejectReturnRequest({
      requestId: req.params.id,
      managerId: req.user.id,
      rejectionReason: req.body?.rejectionReason,
      io,
    });
    const { rows } = await query(`${REQUEST_SELECT} WHERE r.id = $1`, [req.params.id]);
    return ok(res, shapeRequest(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const io = req.app.get('io');
    await returnService.cancelReturnRequest({
      requestId: req.params.id,
      userId: req.user.id,
      io,
    });
    const { rows } = await query(`${REQUEST_SELECT} WHERE r.id = $1`, [req.params.id]);
    return ok(res, shapeRequest(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function lookup(req, res, next) {
  try {
    const mode = (req.query.mode || 'auto').toString();
    const q = (req.query.q || '').toString();
    const data = await returnService.lookupTransaction({ q, mode });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, summary, getOne, create, approve, reject, cancel, lookup };
