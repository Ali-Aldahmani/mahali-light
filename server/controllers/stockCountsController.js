const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { applyStockMovement } = require('../services/stockService');
const { checkReorderThreshold } = require('../services/reorderService');

const initSchema = z.object({
  countType: z.enum(['full', 'partial', 'category']),
  categoryId: z.string().uuid().nullable().optional(),
  variantIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(1000).optional(),
});

const itemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        countedQty: z.number().nullable().optional(),
        notes: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1),
});

const rejectSchema = z.object({
  rejectionReason: z.string().min(3).max(500),
});

function shapeCount(row) {
  return {
    id: row.id,
    countType: row.count_type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    status: row.status,
    initiatedBy: row.initiated_by,
    initiatedByUsername: row.initiated_by_username,
    initiatedAt: row.initiated_at,
    submittedBy: row.submitted_by,
    submittedByUsername: row.submitted_by_username,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedByUsername: row.approved_by_username,
    approvedAt: row.approved_at,
    notes: row.notes,
    rejectionReason: row.rejection_reason,
    totalProducts: row.total_products,
    matchedCount: row.matched_count,
    discrepancyCount: row.discrepancy_count,
    netValueImpact:
      row.net_value_impact == null ? null : Number(row.net_value_impact),
  };
}

function shapeItem(row, includeCost) {
  const out = {
    id: row.id,
    stockCountId: row.stock_count_id,
    productId: row.product_id,
    variantId: row.variant_id,
    systemQty: Number(row.system_qty),
    countedQty: row.counted_qty == null ? null : Number(row.counted_qty),
    difference: row.difference == null ? null : Number(row.difference),
    notes: row.notes,
    countedBy: row.counted_by,
    countedByUsername: row.counted_by_username,
    countedAt: row.counted_at,
    productName: row.product_name,
    productImage: row.product_image,
    unitLabel: row.unit_label,
    sku: row.sku,
    barcode: row.barcode,
  };
  if (includeCost) {
    out.costPrice = row.cost_price == null ? null : Number(row.cost_price);
    out.valueImpact = row.value_impact == null ? null : Number(row.value_impact);
  }
  return out;
}

const COUNT_SQL = `
  SELECT c.*,
         cat.name AS category_name,
         init.username AS initiated_by_username,
         sub.username AS submitted_by_username,
         app.username AS approved_by_username
    FROM stock_counts c
    LEFT JOIN product_categories cat ON cat.id = c.category_id
    LEFT JOIN users init ON init.id = c.initiated_by
    LEFT JOIN users sub ON sub.id = c.submitted_by
    LEFT JOIN users app ON app.id = c.approved_by
`;

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`c.status = $${params.length}`);
    }
    if (req.query.countType) {
      params.push(req.query.countType);
      where.push(`c.count_type = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM stock_counts c ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${COUNT_SQL}
       ${whereSql}
       ORDER BY c.initiated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Surface the active count (in_progress or pending_approval) for the
    // banner on the UI.
    const { rows: activeRows } = await query(
      `${COUNT_SQL} WHERE c.status IN ('draft','in_progress','pending_approval') ORDER BY c.initiated_at DESC LIMIT 1`,
    );

    return ok(res, rows.map(shapeCount), {
      page,
      limit,
      total: countRows[0].total,
      active: activeRows.length ? shapeCount(activeRows[0]) : null,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const includeCost = (req.user?.permissions || []).includes(
      'product.view_cost',
    );

    const { rows } = await query(`${COUNT_SQL} WHERE c.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const count = shapeCount(rows[0]);

    const { rows: items } = await query(
      `SELECT ci.*,
              cu.username AS counted_by_username,
              p.name AS product_name,
              p.image_path AS product_image,
              p.unit_label,
              v.sku, v.internal_barcode AS barcode
         FROM stock_count_items ci
         LEFT JOIN users cu ON cu.id = ci.counted_by
         LEFT JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants v ON v.id = ci.variant_id
        WHERE ci.stock_count_id = $1
        ORDER BY p.name ASC, v.sku ASC`,
      [req.params.id],
    );

    return ok(res, {
      ...count,
      items: items.map((r) => shapeItem(r, includeCost)),
    });
  } catch (err) {
    next(err);
  }
}

async function selectVariantsForCount({ countType, categoryId, variantIds }) {
  if (countType === 'full') {
    const { rows } = await query(
      `SELECT v.id AS variant_id, v.product_id, v.stock_qty, v.cost_price
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true
        ORDER BY p.name, v.sku`,
    );
    return rows;
  }
  if (countType === 'category') {
    if (!categoryId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Category is required for a category count.',
        { status: 400 },
      );
    }
    const { rows } = await query(
      `SELECT v.id AS variant_id, v.product_id, v.stock_qty, v.cost_price
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true
          AND p.category_id IN (
            WITH RECURSIVE t AS (
              SELECT id FROM product_categories WHERE id = $1
              UNION ALL
              SELECT c.id FROM product_categories c JOIN t ON c.parent_id = t.id
            )
            SELECT id FROM t
          )
        ORDER BY p.name, v.sku`,
      [categoryId],
    );
    return rows;
  }
  // partial / custom
  if (!variantIds || !variantIds.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Provide variantIds for a partial count.',
      { status: 400 },
    );
  }
  const { rows } = await query(
    `SELECT v.id AS variant_id, v.product_id, v.stock_qty, v.cost_price
       FROM product_variants v
      WHERE v.id = ANY($1) AND v.is_active = true`,
    [variantIds],
  );
  return rows;
}

async function create(req, res, next) {
  try {
    const body = initSchema.parse(req.body || {});

    // Allow only one open count at a time.
    const { rows: existing } = await query(
      `SELECT id FROM stock_counts
        WHERE status IN ('draft','in_progress','pending_approval')
        LIMIT 1`,
    );
    if (existing.length) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Another stock count is already in progress. Finish it first.',
        { status: 409, details: { activeCountId: existing[0].id } },
      );
    }

    const variants = await selectVariantsForCount(body);
    if (!variants.length) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'No active variants matched the count scope.',
        { status: 400 },
      );
    }

    const countId = await withTransaction(async (client) => {
      const { rows: inserted } = await client.query(
        `INSERT INTO stock_counts
           (count_type, category_id, status, initiated_by, notes, total_products)
         VALUES ($1,$2,'in_progress',$3,$4,$5)
         RETURNING id`,
        [
          body.countType,
          body.categoryId || null,
          req.user.id,
          body.notes || null,
          variants.length,
        ],
      );
      const id = inserted[0].id;
      for (const v of variants) {
        await client.query(
          `INSERT INTO stock_count_items
             (stock_count_id, product_id, variant_id, system_qty, cost_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, v.product_id, v.variant_id, v.stock_qty, v.cost_price],
        );
      }
      return id;
    });

    await logActivity({
      entityType: 'stock_count',
      entityId: countId,
      action: 'stock.count_initiated',
      performedBy: req.user.id,
      notes: `${body.countType} count over ${variants.length} variants`,
    });

    const { rows } = await query(`${COUNT_SQL} WHERE c.id = $1`, [countId]);
    return created(res, shapeCount(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function updateItems(req, res, next) {
  try {
    const includeCost = (req.user?.permissions || []).includes(
      'product.view_cost',
    );
    const body = itemsSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: countRows } = await query(
      `SELECT * FROM stock_counts WHERE id = $1`,
      [id],
    );
    if (!countRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (!['draft', 'in_progress'].includes(countRows[0].status)) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot update a count in status "${countRows[0].status}".`,
        { status: 409 },
      );
    }

    await withTransaction(async (client) => {
      for (const item of body.items) {
        const { rows } = await client.query(
          `SELECT id, system_qty, cost_price FROM stock_count_items
            WHERE id = $1 AND stock_count_id = $2`,
          [item.id, id],
        );
        if (!rows.length) continue;
        const system = Number(rows[0].system_qty);
        const counted =
          item.countedQty === null || item.countedQty === undefined
            ? null
            : Number(item.countedQty);
        const diff = counted === null ? null : counted - system;
        const cost = rows[0].cost_price == null ? null : Number(rows[0].cost_price);
        const valImpact =
          diff !== null && cost !== null ? diff * cost : null;

        await client.query(
          `UPDATE stock_count_items
              SET counted_qty = $1,
                  difference = $2,
                  value_impact = $3,
                  notes = $4,
                  counted_by = $5,
                  counted_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END
            WHERE id = $6`,
          [counted, diff, valImpact, item.notes ?? null, req.user.id, item.id],
        );
      }
    });

    // Update count roll-ups.
    await refreshCountTotals(id);

    // Return the full count.
    const { rows: items } = await query(
      `SELECT ci.*,
              cu.username AS counted_by_username,
              p.name AS product_name,
              p.image_path AS product_image,
              p.unit_label,
              v.sku, v.internal_barcode AS barcode
         FROM stock_count_items ci
         LEFT JOIN users cu ON cu.id = ci.counted_by
         LEFT JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants v ON v.id = ci.variant_id
        WHERE ci.stock_count_id = $1
        ORDER BY p.name ASC, v.sku ASC`,
      [id],
    );
    const { rows: full } = await query(`${COUNT_SQL} WHERE c.id = $1`, [id]);
    return ok(res, {
      ...shapeCount(full[0]),
      items: items.map((r) => shapeItem(r, includeCost)),
    });
  } catch (err) {
    next(err);
  }
}

async function refreshCountTotals(countId) {
  await query(
    `UPDATE stock_counts
        SET matched_count = sub.matched,
            discrepancy_count = sub.discrepancies,
            net_value_impact = sub.net_value
       FROM (
         SELECT
           COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND difference = 0) AS matched,
           COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND difference <> 0) AS discrepancies,
           COALESCE(SUM(value_impact), 0) AS net_value
           FROM stock_count_items WHERE stock_count_id = $1
       ) sub
      WHERE id = $1`,
    [countId],
  );
}

async function submit(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, status FROM stock_counts WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (!['draft', 'in_progress'].includes(rows[0].status)) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot submit a count in status "${rows[0].status}".`,
        { status: 409 },
      );
    }

    // Make sure at least one item was counted.
    const { rows: progress } = await query(
      `SELECT COUNT(*) FILTER (WHERE counted_qty IS NOT NULL)::int AS counted,
              COUNT(*)::int AS total
         FROM stock_count_items WHERE stock_count_id = $1`,
      [id],
    );
    if (progress[0].counted === 0) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'No items have been counted yet.',
        { status: 409 },
      );
    }

    await refreshCountTotals(id);
    await query(
      `UPDATE stock_counts
          SET status = 'pending_approval',
              submitted_by = $1,
              submitted_at = NOW()
        WHERE id = $2`,
      [req.user.id, id],
    );

    await logActivity({
      entityType: 'stock_count',
      entityId: id,
      action: 'stock.count_submitted',
      performedBy: req.user.id,
    });

    const { rows: full } = await query(`${COUNT_SQL} WHERE c.id = $1`, [id]);
    const io = req.app.get('io');
    if (io) {
      const payload = {
        countId: id,
        submittedBy: req.user.id,
        submittedByUsername: req.user.username,
        discrepancyCount: full[0].discrepancy_count,
        netValueImpact: Number(full[0].net_value_impact || 0),
      };
      io.to('role:Manager').emit('stock_count_submitted', payload);
      io.to('role:Admin').emit('stock_count_submitted', payload);
    }

    return ok(res, shapeCount(full[0]));
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const { id } = req.params;

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
          status: 404,
        });
      }
      const count = rows[0];
      if (count.status !== 'pending_approval') {
        throw new AppError(
          ERROR_CODES.BIZ_INVALID_STATE,
          `Cannot approve a count in status "${count.status}".`,
          { status: 409 },
        );
      }

      // Apply a count_correction movement for every item with a non-zero diff.
      const { rows: items } = await client.query(
        `SELECT id, product_id, variant_id, difference, counted_qty
           FROM stock_count_items
          WHERE stock_count_id = $1
            AND counted_qty IS NOT NULL
            AND difference IS NOT NULL
            AND difference <> 0`,
        [id],
      );

      const variantIds = [];
      for (const it of items) {
        await applyStockMovement({
          client,
          variantId: it.variant_id,
          productId: it.product_id,
          type: 'count_correction',
          quantity: Number(it.difference),
          referenceType: 'stock_count',
          referenceId: id,
          employeeId: req.user.id,
          notes: 'Approved stock count correction',
          skipReorderCheck: true,
        });
        variantIds.push(it.variant_id);
      }

      await client.query(
        `UPDATE stock_counts
            SET status = 'approved',
                approved_by = $1,
                approved_at = NOW()
          WHERE id = $2`,
        [req.user.id, id],
      );

      return { count, items, variantIds };
    });

    // Outside the transaction: refresh totals, reorder checks, socket emits.
    await refreshCountTotals(id);

    const io = req.app.get('io');
    for (const vid of result.variantIds) {
      try {
        const r = await checkReorderThreshold(vid);
        if (io && r?.created) {
          io.to('role:Manager').emit('reorder_alert_created', r.payload);
          io.to('role:Admin').emit('reorder_alert_created', r.payload);
        }
      } catch (_e) {
        // best effort
      }
    }

    if (io) {
      // One broad stock_updated so caches refresh — clients can re-query
      // affected variants from the server.
      io.emit('stock_updated', {
        countId: id,
        movementType: 'count_correction',
        affectedVariants: result.variantIds,
        changedBy: req.user.id,
        timestamp: new Date().toISOString(),
      });
      io.to(`user:${result.count.initiated_by}`).emit('stock_count_reviewed', {
        countId: id,
        status: 'approved',
        reviewedBy: req.user.id,
        reviewedByUsername: req.user.username,
      });
    }

    await logActivity({
      entityType: 'stock_count',
      entityId: id,
      action: 'stock.count_approved',
      performedBy: req.user.id,
      notes: `Applied ${result.items.length} corrections`,
    });

    const { rows } = await query(`${COUNT_SQL} WHERE c.id = $1`, [id]);
    return ok(res, shapeCount(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const body = rejectSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows } = await query(`SELECT * FROM stock_counts WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status !== 'pending_approval') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot reject a count in status "${rows[0].status}".`,
        { status: 409 },
      );
    }

    await query(
      `UPDATE stock_counts
          SET status = 'rejected',
              approved_by = $1,
              approved_at = NOW(),
              rejection_reason = $2
        WHERE id = $3`,
      [req.user.id, body.rejectionReason, id],
    );

    await logActivity({
      entityType: 'stock_count',
      entityId: id,
      action: 'stock.count_rejected',
      performedBy: req.user.id,
      notes: body.rejectionReason,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${rows[0].initiated_by}`).emit('stock_count_reviewed', {
        countId: id,
        status: 'rejected',
        reviewedBy: req.user.id,
        reviewedByUsername: req.user.username,
        rejectionReason: body.rejectionReason,
      });
    }

    const { rows: full } = await query(`${COUNT_SQL} WHERE c.id = $1`, [id]);
    return ok(res, shapeCount(full[0]));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, updateItems, submit, approve, reject };
