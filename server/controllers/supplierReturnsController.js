const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { applyStockMovement } = require('../services/stockService');

const REASONS = new Set(['defective', 'wrong_item', 'excess_stock', 'expired']);
const RESOLUTIONS = new Set(['replaced', 'refunded', 'credit_note', 'rejected']);

const itemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
  condition: z.enum(['defective', 'damaged', 'good']).optional().nullable(),
  serialNumber: z.string().max(100).optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  returnDate: z.string().optional().nullable(),
  reason: z.string().refine((r) => REASONS.has(r), 'Invalid reason.'),
  items: z.array(itemSchema).min(1),
  resolutionNotes: z.string().max(2000).optional().nullable(),
});

const resolveSchema = z.object({
  resolution: z.string().refine((r) => RESOLUTIONS.has(r), 'Invalid resolution.'),
  resolutionNotes: z.string().max(2000).optional().nullable(),
});

function shapeReturn(row) {
  return {
    id: row.id,
    returnNumber: row.return_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    purchaseOrderId: row.purchase_order_id,
    poNumber: row.po_number,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username,
    returnDate: row.return_date,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    resolutionNotes: row.resolution_notes,
    totalValue: Number(row.total_value),
    itemsCount: row.items_count != null ? Number(row.items_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeReturnItem(row) {
  return {
    id: row.id,
    supplierReturnId: row.supplier_return_id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: Number(row.quantity),
    unitCost: Number(row.unit_cost),
    totalValue: Number(row.total_value),
    condition: row.condition,
    serialNumber: row.serial_number,
    productName: row.product_name,
    productImage: row.product_image,
    sku: row.sku,
    barcode: row.barcode,
  };
}

const LIST_SELECT = `
  SELECT sr.*, s.name AS supplier_name,
         po.po_number, u.username AS employee_username,
         COALESCE(ic.c, 0) AS items_count
    FROM supplier_returns sr
    LEFT JOIN suppliers s ON s.id = sr.supplier_id
    LEFT JOIN purchase_orders po ON po.id = sr.purchase_order_id
    LEFT JOIN users u ON u.id = sr.employee_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS c FROM supplier_return_items WHERE supplier_return_id = sr.id
    ) ic ON TRUE
`;

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];
    if (req.query.supplierId) {
      params.push(req.query.supplierId);
      where.push(`sr.supplier_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`sr.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM supplier_returns sr ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${LIST_SELECT}
       ${whereSql}
       ORDER BY sr.return_date DESC, sr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return ok(res, rows.map(shapeReturn), {
      page,
      limit,
      total: countRows[0].total,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${LIST_SELECT} WHERE sr.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const { rows: items } = await query(
      `SELECT i.*, p.name AS product_name, p.image_path AS product_image,
              v.sku, v.internal_barcode AS barcode
         FROM supplier_return_items i
         JOIN products p ON p.id = i.product_id
         LEFT JOIN product_variants v ON v.id = i.variant_id
        WHERE i.supplier_return_id = $1
        ORDER BY i.id ASC`,
      [req.params.id],
    );

    return ok(res, {
      ...shapeReturn(rows[0]),
      items: items.map(shapeReturnItem),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    const result = await withTransaction(async (client) => {
      const numberRes = await nextDocumentNumber(client, 'SR');
      const returnNumber = numberRes.formatted;

      // Insert the return record first (we need the id for movements).
      const totalValue = body.items.reduce(
        (sum, i) => sum + Number(i.quantity) * Number(i.unitCost),
        0,
      );

      const { rows: insertRows } = await client.query(
        `INSERT INTO supplier_returns
           (return_number, supplier_id, purchase_order_id, employee_id,
            return_date, reason, status, total_value)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
         RETURNING id`,
        [
          returnNumber,
          body.supplierId,
          body.purchaseOrderId || null,
          req.user.id,
          body.returnDate || new Date().toISOString().slice(0, 10),
          body.reason,
          Math.round(totalValue * 100) / 100,
        ],
      );
      const returnId = insertRows[0].id;

      for (const it of body.items) {
        const lineTotal = Number(it.quantity) * Number(it.unitCost);
        await client.query(
          `INSERT INTO supplier_return_items
             (supplier_return_id, product_id, variant_id, quantity, unit_cost,
              total_value, condition, serial_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            returnId,
            it.productId,
            it.variantId,
            it.quantity,
            it.unitCost,
            Math.round(lineTotal * 100) / 100,
            it.condition || null,
            it.serialNumber || null,
          ],
        );

        // Returning to supplier = stock out of our warehouse.
        await applyStockMovement({
          client,
          variantId: it.variantId,
          productId: it.productId,
          type: 'return_out',
          quantity: it.quantity,
          referenceType: 'supplier_return',
          referenceId: returnId,
          employeeId: req.user.id,
          notes: `Supplier return ${returnNumber}`,
          skipReorderCheck: true,
        });
      }

      return { returnId, returnNumber, affectedVariants: body.items.map((i) => i.variantId) };
    });

    await logActivity({
      entityType: 'supplier_return',
      entityId: result.returnId,
      action: 'supplier_return.created',
      performedBy: req.user.id,
      notes: result.returnNumber,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('stock_updated', {
        movementType: 'return_out',
        affectedVariants: result.affectedVariants,
        referenceType: 'supplier_return',
        referenceId: result.returnId,
        changedBy: req.user.id,
        timestamp: new Date().toISOString(),
      });
      const payload = {
        returnId: result.returnId,
        returnNumber: result.returnNumber,
        supplierId: body.supplierId,
        createdBy: req.user.id,
        createdByUsername: req.user.username,
      };
      io.to('role:Manager').emit('supplier_return_created', payload);
      io.to('role:Admin').emit('supplier_return_created', payload);
    }

    const { rows } = await query(`${LIST_SELECT} WHERE sr.id = $1`, [result.returnId]);
    return created(res, shapeReturn(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function resolve(req, res, next) {
  try {
    const { id } = req.params;
    const body = resolveSchema.parse(req.body || {});

    const { rows } = await query(
      `SELECT id, status FROM supplier_returns WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status === 'resolved') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Return is already resolved.',
        { status: 409 },
      );
    }

    await query(
      `UPDATE supplier_returns
          SET status = 'resolved',
              resolution = $1,
              resolution_notes = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [body.resolution, body.resolutionNotes || null, id],
    );

    await logActivity({
      entityType: 'supplier_return',
      entityId: id,
      action: 'supplier_return.resolved',
      performedBy: req.user.id,
      notes: body.resolution,
    });

    const { rows: full } = await query(`${LIST_SELECT} WHERE sr.id = $1`, [id]);
    return ok(res, shapeReturn(full[0]));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, resolve };
