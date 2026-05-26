const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  applyStockMovement,
  isVariantUnderActiveCount,
} = require('../services/stockService');

const REASONS = new Set([
  'damaged',
  'lost',
  'found',
  'counting_error',
  'expired',
  'other',
]);

const createSchema = z.object({
  variantId: z.string().uuid(),
  adjustmentType: z.enum(['add', 'remove', 'set']),
  quantity: z.number().refine((n) => Number.isFinite(n), 'Quantity must be a number.'),
  reason: z.string().refine((r) => REASONS.has(r), 'Invalid reason.'),
  note: z.string().min(10, 'Please add a note (at least 10 characters).').max(1000),
  applyDirectly: z.boolean().optional().default(false),
});

const rejectSchema = z.object({
  rejectionReason: z.string().min(3).max(500),
});

function shape(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    adjustmentType: row.adjustment_type,
    currentQty: Number(row.current_qty),
    requestedQty: Number(row.requested_qty),
    difference: Number(row.difference),
    reason: row.reason,
    requestNote: row.request_note,
    requestedBy: row.requested_by,
    requestedByUsername: row.requested_by_username,
    requestedAt: row.requested_at,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedByUsername: row.reviewed_by_username,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    appliedMovementId: row.applied_movement_id,
    productName: row.product_name,
    productImage: row.product_image,
    variantSku: row.variant_sku,
    variantBarcode: row.variant_barcode,
    unitLabel: row.unit_label,
  };
}

const LIST_SQL = `
  SELECT a.*,
         req.username AS requested_by_username,
         rev.username AS reviewed_by_username,
         p.name AS product_name,
         p.image_path AS product_image,
         p.unit_label,
         v.sku AS variant_sku,
         v.internal_barcode AS variant_barcode
    FROM stock_adjustment_requests a
    LEFT JOIN users req ON req.id = a.requested_by
    LEFT JOIN users rev ON rev.id = a.reviewed_by
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN product_variants v ON v.id = a.variant_id
`;

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];
    const canApprove = (req.user?.permissions || []).includes(
      'stock.adjust_approve',
    );

    // Non-approvers can only see their own requests.
    if (!canApprove) {
      params.push(req.user.id);
      where.push(`a.requested_by = $${params.length}`);
    }

    if (req.query.status) {
      params.push(req.query.status);
      where.push(`a.status = $${params.length}`);
    }
    if (req.query.productId) {
      params.push(req.query.productId);
      where.push(`a.product_id = $${params.length}`);
    }
    if (req.query.requestedBy) {
      params.push(req.query.requestedBy);
      where.push(`a.requested_by = $${params.length}`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      where.push(`a.requested_at >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      where.push(`a.requested_at <= $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(`(p.name ILIKE $${i} OR v.sku ILIKE $${i})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM stock_adjustment_requests a
         LEFT JOIN products p ON p.id = a.product_id
         LEFT JOIN product_variants v ON v.id = a.variant_id
        ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${LIST_SQL}
       ${whereSql}
       ORDER BY a.requested_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Counters for the badge / tab title.
    const { rows: pendingRows } = await query(
      canApprove
        ? `SELECT COUNT(*)::int AS c FROM stock_adjustment_requests WHERE status = 'pending'`
        : `SELECT COUNT(*)::int AS c FROM stock_adjustment_requests WHERE status = 'pending' AND requested_by = $1`,
      canApprove ? [] : [req.user.id],
    );

    return ok(res, rows.map(shape), {
      page,
      limit,
      total: countRows[0].total,
      pendingCount: pendingRows[0].c,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${LIST_SQL} WHERE a.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    const { rows: variantRows } = await query(
      `SELECT v.id, v.product_id, v.stock_qty, p.name AS product_name
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1`,
      [body.variantId],
    );
    if (!variantRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Variant not found.', {
        status: 404,
      });
    }
    const variant = variantRows[0];

    if (await isVariantUnderActiveCount(body.variantId)) {
      throw new AppError(
        ERROR_CODES.BIZ_STOCK_COUNT_IN_PROGRESS,
        `${variant.product_name} is part of an active stock count.`,
        { status: 409 },
      );
    }

    const currentQty = Number(variant.stock_qty);
    let requestedQty;
    if (body.adjustmentType === 'add') {
      requestedQty = currentQty + Math.abs(body.quantity);
    } else if (body.adjustmentType === 'remove') {
      requestedQty = currentQty - Math.abs(body.quantity);
    } else {
      requestedQty = body.quantity;
    }
    if (requestedQty < 0) {
      throw new AppError(
        ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
        'Resulting stock cannot be negative.',
        { status: 409 },
      );
    }
    const difference = requestedQty - currentQty;

    // Direct apply (manager with adjust_direct can bypass approval).
    const directlyAllowed =
      body.applyDirectly &&
      (req.user.permissions || []).includes('stock.adjust_direct');

    if (directlyAllowed) {
      const io = req.app.get('io');
      const { movement } = await applyStockMovement({
        variantId: body.variantId,
        productId: variant.product_id,
        type: 'adjustment',
        quantity: difference,
        referenceType: 'adjustment_direct',
        employeeId: req.user.id,
        notes: `${body.reason}: ${body.note}`,
        io,
      });

      const { rows: inserted } = await query(
        `INSERT INTO stock_adjustment_requests
           (product_id, variant_id, adjustment_type, current_qty, requested_qty,
            difference, reason, request_note, requested_by,
            status, reviewed_by, reviewed_at, applied_movement_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,NOW(),$11)
         RETURNING id`,
        [
          variant.product_id,
          body.variantId,
          body.adjustmentType,
          currentQty,
          requestedQty,
          difference,
          body.reason,
          body.note,
          req.user.id,
          req.user.id,
          movement.id,
        ],
      );

      await logActivity({
        entityType: 'stock_adjustment',
        entityId: inserted[0].id,
        action: 'stock.adjustment_approved',
        performedBy: req.user.id,
        notes: `Direct adjustment on ${variant.product_name}: ${difference}`,
      });

      const { rows: full } = await query(`${LIST_SQL} WHERE a.id = $1`, [
        inserted[0].id,
      ]);
      return created(res, shape(full[0]));
    }

    const { rows: inserted } = await query(
      `INSERT INTO stock_adjustment_requests
         (product_id, variant_id, adjustment_type, current_qty, requested_qty,
          difference, reason, request_note, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        variant.product_id,
        body.variantId,
        body.adjustmentType,
        currentQty,
        requestedQty,
        difference,
        body.reason,
        body.note,
        req.user.id,
      ],
    );

    await logActivity({
      entityType: 'stock_adjustment',
      entityId: inserted[0].id,
      action: 'stock.adjustment_requested',
      performedBy: req.user.id,
      notes: `${variant.product_name}: ${difference}`,
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        requestId: inserted[0].id,
        productName: variant.product_name,
        productId: variant.product_id,
        variantId: body.variantId,
        difference,
        requestedBy: req.user.id,
        requestedByUsername: req.user.username,
        timestamp: new Date().toISOString(),
      };
      io.to('role:Manager').emit('adjustment_request_created', payload);
      io.to('role:Admin').emit('adjustment_request_created', payload);
    }

    const { rows: full } = await query(`${LIST_SQL} WHERE a.id = $1`, [
      inserted[0].id,
    ]);
    return created(res, shape(full[0]));
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const { id } = req.params;

    // Lock the request row.
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM stock_adjustment_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
      }
      const reqRow = rows[0];
      if (reqRow.status !== 'pending') {
        throw new AppError(
          ERROR_CODES.BIZ_INVALID_STATE,
          `This request is already ${reqRow.status}.`,
          { status: 409 },
        );
      }

      // Make sure we don't apply during an active count.
      if (await isVariantUnderActiveCount(reqRow.variant_id)) {
        throw new AppError(
          ERROR_CODES.BIZ_STOCK_COUNT_IN_PROGRESS,
          'A stock count is currently in progress for this product.',
          { status: 409 },
        );
      }

      // Apply the movement using the SAME client so it's atomic with the
      // request status update.
      const { movement } = await applyStockMovement({
        client,
        variantId: reqRow.variant_id,
        productId: reqRow.product_id,
        type: 'adjustment',
        quantity: Number(reqRow.difference),
        referenceType: 'adjustment_request',
        referenceId: reqRow.id,
        employeeId: req.user.id,
        notes: `${reqRow.reason}: ${reqRow.request_note}`,
        skipReorderCheck: true,
      });

      await client.query(
        `UPDATE stock_adjustment_requests
            SET status = 'approved',
                reviewed_by = $1,
                reviewed_at = NOW(),
                applied_movement_id = $2
          WHERE id = $3`,
        [req.user.id, movement.id, id],
      );

      return { reqRow, movement };
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('stock_updated', {
        productId: result.reqRow.product_id,
        variantId: result.reqRow.variant_id,
        newQty: Number(result.movement.qty_after),
        movementType: 'adjustment',
        delta: Number(result.movement.quantity),
        changedBy: req.user.id,
        timestamp: result.movement.timestamp,
      });
      io.to(`user:${result.reqRow.requested_by}`).emit(
        'adjustment_request_reviewed',
        {
          requestId: id,
          status: 'approved',
          reviewedBy: req.user.id,
          reviewedByUsername: req.user.username,
        },
      );
    }

    // Re-evaluate the reorder threshold now that the change is committed.
    try {
      const { checkReorderThreshold } = require('../services/reorderService');
      const r = await checkReorderThreshold(result.reqRow.variant_id);
      if (io && r?.created) {
        io.to('role:Manager').emit('reorder_alert_created', r.payload);
        io.to('role:Admin').emit('reorder_alert_created', r.payload);
      }
    } catch (_e) {
      // best-effort
    }

    await logActivity({
      entityType: 'stock_adjustment',
      entityId: id,
      action: 'stock.adjustment_approved',
      performedBy: req.user.id,
    });

    const { rows } = await query(`${LIST_SQL} WHERE a.id = $1`, [id]);
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const body = rejectSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows } = await query(
      `SELECT * FROM stock_adjustment_requests WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status !== 'pending') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `This request is already ${rows[0].status}.`,
        { status: 409 },
      );
    }

    await query(
      `UPDATE stock_adjustment_requests
          SET status = 'rejected',
              reviewed_by = $1,
              reviewed_at = NOW(),
              rejection_reason = $2
        WHERE id = $3`,
      [req.user.id, body.rejectionReason, id],
    );

    await logActivity({
      entityType: 'stock_adjustment',
      entityId: id,
      action: 'stock.adjustment_rejected',
      performedBy: req.user.id,
      notes: body.rejectionReason,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${rows[0].requested_by}`).emit('adjustment_request_reviewed', {
        requestId: id,
        status: 'rejected',
        reviewedBy: req.user.id,
        reviewedByUsername: req.user.username,
        rejectionReason: body.rejectionReason,
      });
    }

    const { rows: full } = await query(`${LIST_SQL} WHERE a.id = $1`, [id]);
    return ok(res, shape(full[0]));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, approve, reject };
