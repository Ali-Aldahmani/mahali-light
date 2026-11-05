const { z } = require('zod');
const { todayStoreDate } = require('../utils/dates');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { applyStockMovement } = require('../services/stockService');
const { runOnce, requestKeyFrom } = require('../utils/operations');
const journalService = require('../services/journalService');
const { emitEvent } = require('../socket/events');

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Input VAT claimed on returned goods, at the originating PO's own rate —
// the same rule as returnService's supplier returns. Without a PO we don't
// know what VAT was claimed, so none is reversed.
async function supplierReturnVat(client, purchaseOrderId, value) {
  if (!purchaseOrderId) return 0;
  const { rows: [po] } = await client.query(
    `SELECT subtotal, tax_amount FROM purchase_orders WHERE id = $1`,
    [purchaseOrderId],
  );
  if (!po || Number(po.subtotal) <= 0) return 0;
  return money(value * (Number(po.tax_amount) || 0) / Number(po.subtotal));
}

const REASONS = new Set(['defective', 'wrong_item', 'excess_stock', 'expired']);
const RESOLUTIONS = new Set(['replaced', 'refunded', 'credit_note', 'rejected']);

const itemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  condition: z.enum(['defective', 'damaged', 'good']).optional().nullable(),
  serialNumber: z.string().max(100).optional().nullable(),
});

async function resolveSupplierReturnUnitCost(client, { variantId, purchaseOrderId }) {
  if (purchaseOrderId) {
    const { rows } = await client.query(
      `SELECT cost_price_per_unit
         FROM purchase_order_items
        WHERE purchase_order_id = $1 AND variant_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [purchaseOrderId, variantId],
    );
    if (rows.length) return Math.round(Number(rows[0].cost_price_per_unit) * 100) / 100;
  }
  const { rows } = await client.query(
    `SELECT cost_price FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product variant not found.', {
      status: 404,
    });
  }
  return Math.round(Number(rows[0].cost_price || 0) * 100) / 100;
}

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

// Accounts Payable is debited for what goes back, so a return that names a PO
// can only send back what that supplier delivered on it, less earlier returns.
async function assertReturnFitsPurchaseOrder(client, body) {
  const refuse = (message) => new AppError(ERROR_CODES.VALIDATION_FAILED, message, { status: 400 });
  for (const it of body.items) {
    const { rows } = await client.query(`SELECT product_id FROM product_variants WHERE id = $1`, [it.variantId]);
    if (rows.length && it.productId && rows[0].product_id !== it.productId) {
      throw refuse('That variant belongs to a different product.');
    }
  }
  if (!body.purchaseOrderId) return;
  const { rows: poRows } = await client.query(
    `SELECT supplier_id, status FROM purchase_orders WHERE id = $1 FOR UPDATE`,
    [body.purchaseOrderId],
  );
  if (!poRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Purchase order not found.', { status: 404 });
  }
  if (poRows[0].supplier_id !== body.supplierId) throw refuse('That purchase order is from a different supplier.');
  if (!['received', 'partially_received'].includes(poRows[0].status)) {
    throw refuse('Goods can only be returned against a purchase order that has been received.');
  }
  const wanted = new Map();
  for (const it of body.items) wanted.set(it.variantId, (wanted.get(it.variantId) || 0) + Number(it.quantity));
  for (const [variantId, quantity] of wanted) {
    const { rows: [line] } = await client.query(
      `SELECT
         (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_items
           WHERE purchase_order_id = $1 AND variant_id = $2)::float8 AS received,
         (SELECT COALESCE(SUM(sri.quantity), 0)
            FROM supplier_return_items sri
            JOIN supplier_returns sr ON sr.id = sri.supplier_return_id
           WHERE sr.purchase_order_id = $1 AND sri.variant_id = $2
             AND COALESCE(sr.resolution, '') NOT IN ('rejected', 'replaced'))::float8 AS returned,
         (SELECT COALESCE(SUM(rri.quantity), 0)
            FROM return_request_items rri
            JOIN return_requests rr ON rr.id = rri.return_request_id
           WHERE rr.return_type = 'supplier_return' AND rr.reference_type = 'purchase_order'
             AND rr.reference_id = $1 AND rri.variant_id = $2
             AND rr.status NOT IN ('rejected', 'cancelled'))::float8 AS requested`,
      [body.purchaseOrderId, variantId],
    );
    const left = line.received - line.returned - line.requested;
    if (quantity > left + 0.001) {
      throw refuse(`Only ${Math.max(left, 0)} of this item can still be returned on that purchase order.`);
    }
  }
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

    // A retried create with the same request key returns the first return
    // instead of moving the stock out twice.
    const { result, replayed } = await withTransaction((client) => runOnce(client, {
      scope: 'supplier_return_create',
      key: requestKeyFrom(req),
      userId: req.user.id,
      payload: body,
    }, async () => {
      await assertReturnFitsPurchaseOrder(client, body);

      const numberRes = await nextDocumentNumber(client, 'SR');
      const returnNumber = numberRes.formatted;

      const resolvedItems = [];
      for (const it of body.items) {
        const unitCost = await resolveSupplierReturnUnitCost(client, {
          variantId: it.variantId,
          purchaseOrderId: body.purchaseOrderId || null,
        });
        resolvedItems.push({ ...it, unitCost });
      }

      // Insert the return record first (we need the id for movements).
      const totalValue = resolvedItems.reduce(
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
          body.returnDate || todayStoreDate(),
          body.reason,
          Math.round(totalValue * 100) / 100,
        ],
      );
      const returnId = insertRows[0].id;

      for (const it of resolvedItems) {
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

      // The goods leave at cost, so the ledger does what the approved-return
      // flow (returnService) does: DR Accounts Payable, CR Inventory and the
      // input VAT claimed on them (audit Phase 4, PO F15). Before, this
      // button moved stock with no journal at all.
      const value = money(totalValue);
      await journalService.postSupplierReturnEntry(client, {
        returnOrderId: returnId,
        returnOrderNumber: returnNumber,
        amount: value,
        vatAmount: await supplierReturnVat(client, body.purchaseOrderId || null, value),
        date: body.returnDate || todayStoreDate(),
        userId: req.user.id,
      });

      return { returnId, returnNumber, affectedVariants: body.items.map((i) => i.variantId) };
    }));

    if (replayed) {
      const { rows: again } = await query(`${LIST_SELECT} WHERE sr.id = $1`, [result.returnId]);
      return ok(res, shapeReturn(again[0]));
    }

    await logActivity({
      entityType: 'supplier_return',
      entityId: result.returnId,
      action: 'supplier_return.created',
      performedBy: req.user.id,
      notes: result.returnNumber,
    });

    const io = req.app.get('io');
    if (io) {
      emitEvent(io, 'stock_updated', {
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
      emitEvent(io, 'supplier_return_created', payload);
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

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status, return_number FROM supplier_returns WHERE id = $1 FOR UPDATE`,
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

      // Rejected by the supplier, or replaced with the same goods: the units
      // come back in at the cost they left at, and the return's journal is
      // reversed. A refund or credit note leaves the payable reduction in
      // place.
      if (body.resolution === 'rejected' || body.resolution === 'replaced') {
        const { rows: items } = await client.query(
          `SELECT product_id, variant_id, quantity FROM supplier_return_items WHERE supplier_return_id = $1`,
          [id],
        );
        for (const it of items) {
          await applyStockMovement({
            client,
            variantId: it.variant_id,
            productId: it.product_id,
            type: 'return_in',
            quantity: Number(it.quantity),
            referenceType: 'supplier_return',
            referenceId: id,
            employeeId: req.user.id,
            notes: `Supplier return ${rows[0].return_number} ${body.resolution}`,
            skipReorderCheck: true,
          });
        }
        const { rows: entries } = await client.query(
          `SELECT id FROM journal_entries WHERE reference_type = 'return_order' AND reference_id = $1`,
          [id],
        );
        for (const e of entries) {
          await journalService.reverseJournalEntryWith(client, e.id, {
            description: `Supplier return ${rows[0].return_number} ${body.resolution}`,
            date: todayStoreDate(),
            userId: req.user.id,
          });
        }
      }

      await client.query(
        `UPDATE supplier_returns
            SET status = 'resolved',
                resolution = $1,
                resolution_notes = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [body.resolution, body.resolutionNotes || null, id],
      );
    });

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
