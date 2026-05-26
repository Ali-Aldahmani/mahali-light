const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  generatePoNumber,
  recalculatePOTotals,
  receiveItems: receiveItemsService,
} = require('../services/purchaseOrderService');
const {
  savePurchaseOrderAttachment,
  deleteAttachmentFile,
} = require('../utils/upload');

const itemSchema = z.object({
  variantId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  costPricePerUnit: z.number().nonnegative(),
  unitLabel: z.string().max(20).optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  orderDate: z.string().optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  taxAmount: z.number().nonnegative().optional().default(0),
  notes: z.string().max(4000).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Add at least one item.'),
});

const updateSchema = createSchema.partial({ supplierId: true });

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantityReceived: z.number().positive(),
      }),
    )
    .min(1),
});

function canSeeCost(req) {
  return (req.user?.permissions || []).includes('product.view_cost');
}

function shapePO(row, includeCost) {
  const out = {
    id: row.id,
    poNumber: row.po_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username,
    orderDate: row.order_date,
    expectedDate: row.expected_date,
    receivedDate: row.received_date,
    dueDate: row.due_date,
    status: row.status,
    paymentStatus: row.payment_status,
    notes: row.notes,
    attachmentPath: row.attachment_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemsCount: row.items_count != null ? Number(row.items_count) : undefined,
  };
  if (includeCost) {
    out.subtotal = Number(row.subtotal);
    out.taxAmount = Number(row.tax_amount);
    out.totalCost = Number(row.total_cost);
    out.amountPaid = Number(row.amount_paid);
    out.balanceDue = Number(row.balance_due);
  } else {
    // Even without cost permission we still show payment progress so cashiers
    // can see status, but we hide the actual amounts.
    out.amountPaid = null;
    out.balanceDue = null;
  }
  return out;
}

function shapePOItem(row, includeCost) {
  const out = {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: Number(row.quantity),
    unitLabel: row.unit_label,
    quantityReceived: Number(row.quantity_received),
    quantityRemaining:
      Number(row.quantity) - Number(row.quantity_received),
    productName: row.product_name,
    productImage: row.product_image,
    sku: row.sku,
    barcode: row.barcode,
  };
  if (includeCost) {
    out.costPricePerUnit = Number(row.cost_price_per_unit);
    out.totalCost = Number(row.total_cost);
  }
  return out;
}

const LIST_SELECT = `
  SELECT po.*,
         s.name AS supplier_name,
         u.username AS employee_username,
         COALESCE(items.c, 0) AS items_count
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN users u ON u.id = po.employee_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS c FROM purchase_order_items WHERE purchase_order_id = po.id
    ) items ON TRUE
`;

async function list(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];

    if (req.query.supplierId) {
      params.push(req.query.supplierId);
      where.push(`po.supplier_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`po.status = $${params.length}`);
    }
    if (req.query.paymentStatus) {
      params.push(req.query.paymentStatus);
      where.push(`po.payment_status = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(`(po.po_number ILIKE $${i} OR s.name ILIKE $${i})`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      where.push(`po.order_date >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      where.push(`po.order_date <= $${params.length}`);
    }
    if (req.query.overdue === 'true' || req.query.overdue === '1') {
      where.push(
        `po.due_date IS NOT NULL AND po.due_date < CURRENT_DATE AND po.payment_status <> 'paid' AND po.status <> 'cancelled'`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
        ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${LIST_SELECT}
       ${whereSql}
       ORDER BY po.order_date DESC, po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Roll-ups for the summary cards.
    const { rows: totals } = await query(
      `SELECT
         COUNT(*)::int AS total_pos,
         COUNT(*) FILTER (WHERE payment_status <> 'paid' AND status <> 'cancelled')::int AS pending_payment,
         COUNT(*) FILTER (
           WHERE due_date IS NOT NULL
             AND due_date < CURRENT_DATE
             AND payment_status <> 'paid'
             AND status <> 'cancelled'
         )::int AS overdue_count,
         COALESCE(SUM(
           CASE WHEN due_date IS NOT NULL
                  AND due_date < CURRENT_DATE
                  AND payment_status <> 'paid'
                  AND status <> 'cancelled'
             THEN balance_due ELSE 0 END
         ), 0)::numeric AS overdue_amount,
         COALESCE(SUM(
           CASE WHEN DATE_TRUNC('month', order_date) = DATE_TRUNC('month', CURRENT_DATE)
                  AND status <> 'cancelled'
             THEN total_cost ELSE 0 END
         ), 0)::numeric AS this_month_spent
         FROM purchase_orders`,
    );

    return ok(res, rows.map((r) => shapePO(r, includeCost)), {
      page,
      limit,
      total: countRows[0].total,
      totals: {
        totalPos: totals[0].total_pos,
        pendingPayment: totals[0].pending_payment,
        overdueCount: totals[0].overdue_count,
        overdueAmount: includeCost ? Number(totals[0].overdue_amount) : null,
        thisMonthSpent: includeCost ? Number(totals[0].this_month_spent) : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;

    const { rows } = await query(`${LIST_SELECT} WHERE po.id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const { rows: items } = await query(
      `SELECT i.*, p.name AS product_name, p.image_path AS product_image,
              v.sku, v.internal_barcode AS barcode
         FROM purchase_order_items i
         JOIN products p ON p.id = i.product_id
         JOIN product_variants v ON v.id = i.variant_id
        WHERE i.purchase_order_id = $1
        ORDER BY i.created_at ASC`,
      [id],
    );

    return ok(res, {
      ...shapePO(rows[0], includeCost),
      items: items.map((it) => shapePOItem(it, includeCost)),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const includeCost = canSeeCost(req);

    // Validate supplier is active.
    const { rows: supplierRows } = await query(
      `SELECT id, name, is_active FROM suppliers WHERE id = $1`,
      [body.supplierId],
    );
    if (!supplierRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Supplier not found.', {
        status: 404,
      });
    }
    if (!supplierRows[0].is_active) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Supplier is inactive.',
        { status: 409 },
      );
    }

    const taxAmount = Number(body.taxAmount || 0);

    const poId = await withTransaction(async (client) => {
      const poNumber = await generatePoNumber(client);
      const { rows } = await client.query(
        `INSERT INTO purchase_orders
           (po_number, supplier_id, employee_id, order_date, expected_date,
            due_date, status, tax_amount, notes)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8)
         RETURNING id`,
        [
          poNumber,
          body.supplierId,
          req.user.id,
          body.orderDate || new Date().toISOString().slice(0, 10),
          body.expectedDate || null,
          body.dueDate || null,
          taxAmount,
          body.notes || null,
        ],
      );
      const id = rows[0].id;

      for (const it of body.items) {
        await client.query(
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, variant_id, quantity, unit_label,
              cost_price_per_unit, total_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$4*$6)`,
          [
            id,
            it.productId,
            it.variantId,
            it.quantity,
            it.unitLabel || null,
            it.costPricePerUnit,
          ],
        );
      }
      await recalculatePOTotals(client, id);
      return id;
    });

    await logActivity({
      entityType: 'purchase_order',
      entityId: poId,
      action: 'purchase_order.created',
      performedBy: req.user.id,
    });

    const io = req.app.get('io');
    if (io) {
      const { rows } = await query(`${LIST_SELECT} WHERE po.id = $1`, [poId]);
      const payload = {
        poId,
        poNumber: rows[0].po_number,
        supplierId: rows[0].supplier_id,
        supplierName: rows[0].supplier_name,
        totalCost: Number(rows[0].total_cost),
        createdBy: req.user.id,
        createdByUsername: req.user.username,
      };
      io.to('role:Manager').emit('po_created', payload);
      io.to('role:Admin').emit('po_created', payload);
    }

    const { rows: full } = await query(`${LIST_SELECT} WHERE po.id = $1`, [poId]);
    return created(res, shapePO(full[0], includeCost));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const body = updateSchema.parse(req.body || {});

    const { rows: existing } = await query(
      `SELECT status FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (existing[0].status !== 'draft') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Only draft purchase orders can be edited.',
        { status: 409 },
      );
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE purchase_orders
            SET supplier_id = COALESCE($1, supplier_id),
                order_date = COALESCE($2, order_date),
                expected_date = $3,
                due_date = $4,
                tax_amount = COALESCE($5, tax_amount),
                notes = $6,
                updated_at = NOW()
          WHERE id = $7`,
        [
          body.supplierId || null,
          body.orderDate || null,
          body.expectedDate || null,
          body.dueDate || null,
          body.taxAmount,
          body.notes || null,
          id,
        ],
      );

      if (body.items) {
        await client.query(
          `DELETE FROM purchase_order_items WHERE purchase_order_id = $1`,
          [id],
        );
        for (const it of body.items) {
          await client.query(
            `INSERT INTO purchase_order_items
               (purchase_order_id, product_id, variant_id, quantity, unit_label,
                cost_price_per_unit, total_cost)
             VALUES ($1,$2,$3,$4,$5,$6,$4*$6)`,
            [id, it.productId, it.variantId, it.quantity, it.unitLabel || null, it.costPricePerUnit],
          );
        }
      }
      await recalculatePOTotals(client, id);
    });

    await logActivity({
      entityType: 'purchase_order',
      entityId: id,
      action: 'purchase_order.updated',
      performedBy: req.user.id,
    });

    const { rows: full } = await query(`${LIST_SELECT} WHERE po.id = $1`, [id]);
    return ok(res, shapePO(full[0], includeCost));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT status, po_number, attachment_path FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status !== 'draft') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Only draft purchase orders can be deleted.',
        { status: 409 },
      );
    }
    await query(`DELETE FROM purchase_orders WHERE id = $1`, [id]);

    if (rows[0].attachment_path) {
      deleteAttachmentFile(rows[0].attachment_path);
    }

    await logActivity({
      entityType: 'purchase_order',
      entityId: id,
      action: 'purchase_order.cancelled',
      performedBy: req.user.id,
      notes: rows[0].po_number,
    });
    return ok(res, { id, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function confirm(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const { rows } = await query(
      `SELECT status FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status !== 'draft') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot confirm a PO in status "${rows[0].status}".`,
        { status: 409 },
      );
    }
    await query(
      `UPDATE purchase_orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
      [id],
    );

    await logActivity({
      entityType: 'purchase_order',
      entityId: id,
      action: 'purchase_order.confirmed',
      performedBy: req.user.id,
    });

    const { rows: full } = await query(`${LIST_SELECT} WHERE po.id = $1`, [id]);
    return ok(res, shapePO(full[0], includeCost));
  } catch (err) {
    next(err);
  }
}

async function receive(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const body = receiveSchema.parse(req.body || {});

    const result = await receiveItemsService({
      poId: id,
      items: body.items,
      employeeId: req.user.id,
    });

    await logActivity({
      entityType: 'purchase_order',
      entityId: id,
      action: 'purchase_order.received',
      performedBy: req.user.id,
      notes: `Received ${body.items.length} line${body.items.length === 1 ? '' : 's'}`,
    });

    // Now that the transaction is committed, emit sockets and re-check reorder.
    const io = req.app.get('io');
    if (io) {
      io.emit('stock_updated', {
        productId: null,
        movementType: 'purchase',
        affectedVariants: result.affectedVariants,
        changedBy: req.user.id,
        timestamp: new Date().toISOString(),
        referenceType: 'purchase_order',
        referenceId: id,
      });

      const payload = {
        poId: id,
        poNumber: result.po.po_number,
        status: result.po.status,
        affectedVariants: result.affectedVariants,
        receivedBy: req.user.id,
        receivedByUsername: req.user.username,
      };
      io.to('role:Manager').emit('po_received', payload);
      io.to('role:Admin').emit('po_received', payload);
    }

    // Re-check reorder thresholds for the receiving variants — purchase
    // typically dismisses pending alerts as stock rises above threshold.
    try {
      const { checkReorderThreshold } = require('../services/reorderService');
      for (const vid of result.affectedVariants) {
        await checkReorderThreshold(vid);
      }
    } catch (_e) {
      // best effort
    }

    if (result.costChanges.length) {
      for (const change of result.costChanges) {
        await logActivity({
          entityType: 'product_variant',
          entityId: change.variantId,
          action: 'product.cost_updated',
          performedBy: req.user.id,
          newValue: { oldCost: change.oldCost, newCost: change.newCost },
        });
      }
    }

    const { rows: full } = await query(`${LIST_SELECT} WHERE po.id = $1`, [id]);
    const { rows: items } = await query(
      `SELECT i.*, p.name AS product_name, p.image_path AS product_image,
              v.sku, v.internal_barcode AS barcode
         FROM purchase_order_items i
         JOIN products p ON p.id = i.product_id
         JOIN product_variants v ON v.id = i.variant_id
        WHERE i.purchase_order_id = $1
        ORDER BY i.created_at ASC`,
      [id],
    );
    return ok(res, {
      ...shapePO(full[0], includeCost),
      items: items.map((it) => shapePOItem(it, includeCost)),
      costChanges: includeCost ? result.costChanges : [],
    });
  } catch (err) {
    next(err);
  }
}

async function uploadAttachment(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT attachment_path FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file uploaded.', {
        status: 400,
      });
    }

    if (rows[0].attachment_path) {
      deleteAttachmentFile(rows[0].attachment_path);
    }

    const saved = await savePurchaseOrderAttachment({ poId: id, file: req.file });
    await query(
      `UPDATE purchase_orders SET attachment_path = $1, updated_at = NOW() WHERE id = $2`,
      [saved.relativePath, id],
    );

    await logActivity({
      entityType: 'purchase_order',
      entityId: id,
      action: 'purchase_order.attachment_uploaded',
      performedBy: req.user.id,
      notes: saved.originalName,
    });

    return ok(res, {
      attachmentPath: saved.relativePath,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      size: saved.size,
    });
  } catch (err) {
    next(err);
  }
}

async function removeAttachment(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT attachment_path FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].attachment_path) {
      deleteAttachmentFile(rows[0].attachment_path);
    }
    await query(
      `UPDATE purchase_orders SET attachment_path = NULL, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return ok(res, { id, attachmentPath: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  confirm,
  receive,
  uploadAttachment,
  removeAttachment,
};
