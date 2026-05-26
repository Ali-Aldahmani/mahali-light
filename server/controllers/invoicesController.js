const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  generateInvoiceNumber,
  replaceItems,
  recalculateAndPersistTotals,
  confirmInvoice,
  cancelInvoice,
  computeLineFigures,
} = require('../services/invoiceService');

// -- helpers --------------------------------------------------------------

function canSeeCost(req) {
  const p = req.user?.permissions || [];
  return p.includes('product.view_cost') || p.includes('*');
}

function canDirectCancel(req) {
  const p = req.user?.permissions || [];
  return p.includes('invoice.cancel');
}

function shapeInvoice(row, opts = {}) {
  const out = {
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    customerCompany: row.customer_company || null,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    confirmedBy: row.confirmed_by,
    confirmedByUsername: row.confirmed_by_username || null,
    cancelledBy: row.cancelled_by,
    cancelledByUsername: row.cancelled_by_username || null,
    cancelReason: row.cancel_reason,
    pcIdentifier: row.pc_identifier,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    updatedAt: row.updated_at,
    status: row.status,
    paymentStatus: row.payment_status,
    subtotal: Number(row.subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    invoiceDiscount: Number(row.invoice_discount || 0),
    taxableAmount: Number(row.taxable_amount || 0),
    taxRate: Number(row.tax_rate || 0),
    taxAmount: Number(row.tax_amount || 0),
    total: Number(row.total || 0),
    amountPaid: Number(row.amount_paid || 0),
    balanceDue: Number(row.balance_due || 0),
    hasReturn: !!row.has_return,
    notes: row.notes,
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
  };
  if (opts.creditBalance != null)
    out.customerCreditBalance = Number(opts.creditBalance);
  return out;
}

function shapeItem(row, { includeCost = false } = {}) {
  const out = {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productName: row.product_name,
    variantAttributes: row.variant_attributes || {},
    sku: row.sku,
    unitLabel: row.unit_label,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    discountPercent: Number(row.discount_percent || 0),
    discountAmount: Number(row.discount_amount || 0),
    lineSubtotal: Number(row.line_subtotal),
    lineTotal: Number(row.line_total),
    position: row.position,
    serialNumber: row.serial_number || null,
  };
  if (includeCost) out.costPriceAtTime = Number(row.cost_price_at_time);
  return out;
}

function shapePayment(row) {
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

// SELECT join used by list/getOne to attach customer + user labels.
const INVOICE_SELECT = `
  SELECT i.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         c.company_name AS customer_company,
         c.credit_balance AS customer_credit_balance,
         u1.username AS created_by_username,
         u2.username AS confirmed_by_username,
         u3.username AS cancelled_by_username,
         (SELECT COUNT(*)::int FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN users u1 ON u1.id = i.created_by
    LEFT JOIN users u2 ON u2.id = i.confirmed_by
    LEFT JOIN users u3 ON u3.id = i.cancelled_by
`;

// -- list -----------------------------------------------------------------

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });
    const where = [];
    const params = [];

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(
        `(i.invoice_number ILIKE $${i} OR c.name ILIKE $${i} OR c.phone ILIKE $${i})`,
      );
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`i.status = $${params.length}`);
    }
    if (req.query.paymentStatus) {
      params.push(req.query.paymentStatus);
      where.push(`i.payment_status = $${params.length}`);
    }
    if (req.query.customerId) {
      params.push(req.query.customerId);
      where.push(`i.customer_id = $${params.length}`);
    }
    if (req.query.createdBy) {
      params.push(req.query.createdBy);
      where.push(`i.created_by = $${params.length}`);
    }
    if (req.query.pcIdentifier) {
      params.push(req.query.pcIdentifier);
      where.push(`i.pc_identifier = $${params.length}`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      where.push(`i.created_at >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      where.push(`i.created_at < ($${params.length}::date + interval '1 day')`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${INVOICE_SELECT}
       ${whereSql}
       ORDER BY i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Summary cards (always today + month-to-date roll-ups).
    const { rows: summaryRows } = await query(`
      SELECT
        COALESCE(SUM(total) FILTER (
          WHERE status = 'confirmed'
            AND created_at::date = CURRENT_DATE
        ), 0)::numeric AS revenue_today,
        COUNT(*) FILTER (
          WHERE status = 'confirmed'
            AND created_at::date = CURRENT_DATE
        )::int AS invoices_today,
        COALESCE(SUM(balance_due) FILTER (
          WHERE status = 'confirmed' AND balance_due > 0
        ), 0)::numeric AS outstanding,
        COALESCE(SUM(total) FILTER (
          WHERE status = 'confirmed'
            AND created_at >= date_trunc('month', CURRENT_DATE)
        ), 0)::numeric AS revenue_month
      FROM invoices
    `);

    return ok(
      res,
      rows.map((r) => shapeInvoice(r)),
      {
        page,
        limit,
        total: countRows[0].total,
        totals: {
          revenueToday: Number(summaryRows[0].revenue_today),
          invoicesToday: summaryRows[0].invoices_today,
          outstanding: Number(summaryRows[0].outstanding),
          revenueMonth: Number(summaryRows[0].revenue_month),
        },
      },
    );
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const invoiceRow = rows[0];

    const { rows: itemRows } = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1
        ORDER BY position ASC, created_at ASC`,
      [id],
    );
    const { rows: paymentRows } = await query(
      `SELECT p.*, u.username AS employee_username
         FROM invoice_payments p
         LEFT JOIN users u ON u.id = p.employee_id
        WHERE p.invoice_id = $1
        ORDER BY timestamp ASC`,
      [id],
    );
    const { rows: editReqs } = await query(
      `SELECT r.*, u1.username AS requested_by_username,
              u2.username AS reviewed_by_username
         FROM invoice_edit_requests r
         LEFT JOIN users u1 ON u1.id = r.requested_by
         LEFT JOIN users u2 ON u2.id = r.reviewed_by
        WHERE r.invoice_id = $1
        ORDER BY r.requested_at DESC`,
      [id],
    );
    const { rows: historyRows } = await query(
      `SELECT h.*, u.username AS performed_by_username
         FROM invoice_history h
         LEFT JOIN users u ON u.id = h.performed_by
        WHERE h.invoice_id = $1
        ORDER BY h.timestamp ASC`,
      [id],
    );

    const includeCost = canSeeCost(req);
    return ok(res, {
      invoice: shapeInvoice(invoiceRow, {
        creditBalance: invoiceRow.customer_credit_balance,
      }),
      items: itemRows.map((r) => shapeItem(r, { includeCost })),
      payments: paymentRows.map(shapePayment),
      editRequests: editReqs.map((r) => ({
        id: r.id,
        invoiceId: r.invoice_id,
        requestedBy: r.requested_by,
        requestedByUsername: r.requested_by_username,
        requestedAt: r.requested_at,
        requestNote: r.request_note,
        status: r.status,
        reviewedBy: r.reviewed_by,
        reviewedByUsername: r.reviewed_by_username,
        reviewedAt: r.reviewed_at,
        rejectionReason: r.rejection_reason,
        changes: r.changes,
      })),
      history: historyRows.map((r) => ({
        id: r.id,
        action: r.action,
        performedBy: r.performed_by,
        performedByUsername: r.performed_by_username,
        timestamp: r.timestamp,
        oldSnapshot: r.old_snapshot,
        newSnapshot: r.new_snapshot,
        notes: r.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// -- create draft ---------------------------------------------------------

const itemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  serialNumber: z.string().max(100).optional().nullable(),
});

const createSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  pcIdentifier: z.string().min(1).max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).default([]),
  invoiceDiscount: z.number().nonnegative().optional().default(0),
  taxRate: z.number().min(0).max(100).optional().default(5),
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    const result = await withTransaction(async (client) => {
      const { invoiceNumber, pcCode } = await generateInvoiceNumber(client, {
        pcIdentifier: body.pcIdentifier || 'P0',
      });

      const { rows } = await client.query(
        `INSERT INTO invoices (
          invoice_number, customer_id, created_by, status,
          invoice_discount, tax_rate, pc_identifier, notes
        ) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7)
        RETURNING id`,
        [
          invoiceNumber,
          body.customerId || null,
          req.user.id,
          body.invoiceDiscount || 0,
          body.taxRate ?? 5,
          pcCode,
          body.notes || null,
        ],
      );
      const id = rows[0].id;

      if (body.items.length) {
        await replaceItems(
          client,
          id,
          body.items.map((i) => ({
            variant_id: i.variantId,
            quantity: i.quantity,
            unit_price: i.unitPrice,
            discount_amount: i.discountAmount,
            discount_percent: i.discountPercent,
            serial_number: i.serialNumber,
          })),
        );
      }

      await recalculateAndPersistTotals(client, id);
      await client.query(
        `INSERT INTO invoice_history (invoice_id, action, performed_by, notes)
         VALUES ($1, 'created', $2, $3)`,
        [id, req.user.id, `Draft created with ${body.items.length} item(s)`],
      );
      return { id, invoiceNumber };
    });

    await logActivity({
      entityType: 'invoice',
      entityId: result.id,
      action: 'invoice.created',
      performedBy: req.user.id,
      notes: result.invoiceNumber,
    });

    const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [
      result.id,
    ]);
    return created(res, shapeInvoice(rows[0]));
  } catch (err) {
    next(err);
  }
}

// -- update items (draft only) -------------------------------------------

const updateItemsSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  invoiceDiscount: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema),
});

async function updateItems(req, res, next) {
  try {
    const { id } = req.params;
    const body = updateItemsSchema.parse(req.body || {});

    await withTransaction(async (client) => {
      const { rows: invRows } = await client.query(
        `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!invRows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
          status: 404,
        });
      }
      if (invRows[0].status !== 'draft') {
        throw new AppError(
          ERROR_CODES.BIZ_INVOICE_LOCKED,
          'Only draft invoices can be edited directly.',
          { status: 409 },
        );
      }

      await client.query(
        `UPDATE invoices
            SET customer_id = $1,
                invoice_discount = COALESCE($2, invoice_discount),
                notes = COALESCE($3, notes),
                updated_by = $4,
                updated_at = NOW()
          WHERE id = $5`,
        [
          body.customerId ?? null,
          body.invoiceDiscount,
          body.notes,
          req.user.id,
          id,
        ],
      );

      await replaceItems(
        client,
        id,
        body.items.map((i) => ({
          variant_id: i.variantId,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          discount_amount: i.discountAmount,
          discount_percent: i.discountPercent,
          serial_number: i.serialNumber,
        })),
      );

      await recalculateAndPersistTotals(client, id);
    });

    await logActivity({
      entityType: 'invoice',
      entityId: id,
      action: 'invoice.items_updated',
      performedBy: req.user.id,
      notes: `${body.items.length} item(s)`,
    });

    const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
    return ok(res, shapeInvoice(rows[0]));
  } catch (err) {
    next(err);
  }
}

// -- confirm --------------------------------------------------------------

async function confirm(req, res, next) {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    const result = await confirmInvoice({
      invoiceId: id,
      employeeId: req.user.id,
      io,
    });

    const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
    const { rows: itemRows } = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1
        ORDER BY position ASC, created_at ASC`,
      [id],
    );
    const { rows: paymentRows } = await query(
      `SELECT p.*, u.username AS employee_username
         FROM invoice_payments p
         LEFT JOIN users u ON u.id = p.employee_id
        WHERE p.invoice_id = $1
        ORDER BY timestamp ASC`,
      [id],
    );
    const includeCost = canSeeCost(req);
    const warranties = (result.warranties || []).map((w) => ({
      id: w.id,
      warrantyNumber: w.warranty_number,
      productId: w.product_id,
      variantId: w.variant_id,
      invoiceItemId: w.invoice_item_id,
      serialNumber: w.serial_number,
      startDate: w.start_date,
      endDate: w.end_date,
      durationMonths: w.duration_months,
      status: w.status,
    }));
    return ok(res, {
      invoice: shapeInvoice(rows[0]),
      items: itemRows.map((r) => shapeItem(r, { includeCost })),
      payments: paymentRows.map(shapePayment),
      totals: result.totals,
      warranties,
    });
  } catch (err) {
    next(err);
  }
}

// -- cancel ---------------------------------------------------------------

async function cancel(req, res, next) {
  try {
    const { id } = req.params;
    if (!canDirectCancel(req)) {
      throw new AppError(
        ERROR_CODES.BIZ_EDIT_REQUEST_REQUIRED,
        'Submit an edit request to cancel this invoice.',
        { status: 403 },
      );
    }
    const reason = (req.body?.reason || '').toString().trim() || null;
    const io = req.app.get('io');
    await cancelInvoice({
      invoiceId: id,
      employeeId: req.user.id,
      reason,
      io,
    });
    const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
    return ok(res, shapeInvoice(rows[0]));
  } catch (err) {
    next(err);
  }
}

// -- next number preview (for offline / UI display) -----------------------

async function nextNumberPreview(req, res, next) {
  try {
    const pc = (req.query.pcIdentifier || 'P0').toString();
    // Reads the last_value WITHOUT incrementing. UI display only.
    const yr = new Date().getFullYear();
    const { rows } = await query(
      `SELECT last_value FROM document_sequences
        WHERE doc_type = 'INV' AND year = $1 AND scope = $2`,
      [yr, pc.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'P0'],
    );
    const next = (rows[0]?.last_value || 0) + 1;
    const padded = String(next).padStart(5, '0');
    const code = pc.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'P0';
    return ok(res, {
      preview: `INV-${yr}-${code}-${padded}`,
      year: yr,
      pcCode: code,
      sequence: next,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  updateItems,
  confirm,
  cancel,
  nextNumberPreview,
  computeLineFigures,
};
