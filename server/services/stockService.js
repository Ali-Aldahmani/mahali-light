const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { checkReorderThreshold } = require('./reorderService');
const journalService = require('./journalService');

// Movement types that require an inventory-vs-equity journal entry. Sales +
// purchases + quarantine moves are excluded — those flow through invoice /
// PO receive / refund entries and posting again here would double-count.
const ADJUSTMENT_JOURNAL_TYPES = new Set([
  'adjustment',
  'adjustment_in',
  'adjustment_out',
  'count_correction',
  'count_correction_in',
  'count_correction_out',
]);

// Movement type → sign convention for sales-style "delta" inputs.
// Positive `quantity` always means stock is going IN, negative means going OUT.
// Callers can also supply an unsigned amount + `direction: 'in' | 'out'`
// which we'll normalize.
const POSITIVE_TYPES = new Set([
  'purchase',
  'return_in',
  'adjustment_in',
  'count_correction_in',
  'quarantine_release',
  'opening_stock',
]);

const NEGATIVE_TYPES = new Set([
  'sale',
  'return_out',
  'adjustment_out',
  'count_correction_out',
  'quarantine',
]);

const SIGNED_ALLOWED = new Set([
  'adjustment',
  'count_correction',
]);

const SALES_OUT_TYPES = new Set(['sale']);

function normalizeQuantity(type, quantity) {
  const n = Number(quantity);
  if (Number.isNaN(n)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Movement quantity must be a number.',
      { status: 400 },
    );
  }
  if (n === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Movement quantity cannot be zero.',
      { status: 400 },
    );
  }
  // For known directional types we override the caller-supplied sign so
  // that "purchase 5" always increases stock and "sale 5" always decreases.
  const abs = Math.abs(n);
  if (POSITIVE_TYPES.has(type)) return abs;
  if (NEGATIVE_TYPES.has(type)) return -abs;
  if (SIGNED_ALLOWED.has(type)) return n;
  return n;
}

/**
 * Apply a stock movement atomically.
 * All stock changes in the system must go through this function.
 *
 * @param {object} params
 * @param {object} [params.client]      Optional pg client from an outer transaction.
 * @param {string} params.variantId
 * @param {string} [params.productId]   Optional, will be inferred from variant.
 * @param {string} params.type          See POSITIVE_TYPES / NEGATIVE_TYPES / SIGNED_ALLOWED.
 * @param {number} params.quantity      Magnitude (sign is enforced by type).
 * @param {string} [params.referenceType]
 * @param {string} [params.referenceId]
 * @param {string} [params.employeeId]
 * @param {string} [params.notes]
 * @param {object} [params.io]          Socket.io server for stock_updated emit.
 * @param {boolean} [params.skipReorderCheck]
 *
 * @returns {Promise<{ movement, variant, reorderResult }>}
 */
async function applyStockMovement(params) {
  const {
    variantId,
    productId: paramProductId,
    type,
    quantity,
    referenceType = null,
    referenceId = null,
    employeeId = null,
    notes = null,
    io = null,
    skipReorderCheck = false,
  } = params;

  if (!variantId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'variantId is required.', {
      status: 400,
    });
  }
  if (!type) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'type is required.', {
      status: 400,
    });
  }

  const delta = normalizeQuantity(type, quantity);

  // Allow a caller to supply an existing client (outer transaction).
  const doWork = async (client) => {
    // Lock the variant row to prevent concurrent updates.
    const { rows: lockRows } = await client.query(
      `SELECT id, product_id, stock_qty, quarantine_qty
         FROM product_variants
        WHERE id = $1
        FOR UPDATE`,
      [variantId],
    );
    if (!lockRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Variant not found.', {
        status: 404,
      });
    }
    const row = lockRows[0];
    const productId = paramProductId || row.product_id;

    // Read product unit_label for the movement record.
    const { rows: prodRows } = await client.query(
      `SELECT unit_label FROM products WHERE id = $1`,
      [productId],
    );
    const unitLabel = prodRows[0]?.unit_label || null;

    const before = Number(row.stock_qty);
    const beforeQuarantine = Number(row.quarantine_qty);
    let after = before;
    let newQuarantine = beforeQuarantine;

    if (type === 'quarantine') {
      // Move out of stock, into quarantine.
      const amount = Math.abs(delta);
      if (before - amount < 0) {
        throw new AppError(
          ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
          `Cannot quarantine ${amount}; only ${before} on hand.`,
          { status: 409, details: { available: before, requested: amount } },
        );
      }
      after = before - amount;
      newQuarantine = beforeQuarantine + amount;
    } else if (type === 'quarantine_release') {
      const amount = Math.abs(delta);
      if (beforeQuarantine - amount < 0) {
        throw new AppError(
          ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
          `Cannot release ${amount}; only ${beforeQuarantine} in quarantine.`,
          { status: 409 },
        );
      }
      after = before + amount;
      newQuarantine = beforeQuarantine - amount;
    } else {
      after = before + delta;
      if (after < 0) {
        if (SALES_OUT_TYPES.has(type) || delta < 0) {
          throw new AppError(
            ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
            `Not enough stock. Available: ${before}, requested: ${Math.abs(delta)}.`,
            {
              status: 409,
              details: { available: before, requested: Math.abs(delta) },
            },
          );
        }
        // For non-sale types we still refuse to go negative.
        throw new AppError(
          ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
          'Stock cannot go below zero.',
          { status: 409 },
        );
      }
    }

    // Round to 4 decimals to avoid floating-point drift.
    const rounded = (n) => Math.round(n * 10000) / 10000;
    const finalAfter = rounded(after);
    const finalQuarantine = rounded(newQuarantine);

    await client.query(
      `UPDATE product_variants
          SET stock_qty = $1,
              quarantine_qty = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [finalAfter, finalQuarantine, variantId],
    );

    // Persisted quantity for the movement row uses the actual signed delta
    // (positive for IN, negative for OUT). For quarantine* moves we use the
    // unsigned amount with a sign that matches the stock_qty change.
    const movementQuantity = ['quarantine', 'quarantine_release'].includes(type)
      ? finalAfter - before
      : delta;

    const { rows: movementRows } = await client.query(
      `INSERT INTO stock_movements
         (product_id, variant_id, movement_type, quantity, qty_before, qty_after,
          reference_type, reference_id, unit_label, employee_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        productId,
        variantId,
        type,
        movementQuantity,
        before,
        finalAfter,
        referenceType,
        referenceId,
        unitLabel,
        employeeId,
        notes,
      ],
    );

    // Stock adjustments + count corrections post inventory ↔ equity.
    if (ADJUSTMENT_JOURNAL_TYPES.has(type) && Math.abs(movementQuantity) > 0) {
      const { rows: costRows } = await client.query(
        `SELECT cost_price FROM product_variants WHERE id = $1`,
        [variantId],
      );
      const costPrice = Number(costRows[0]?.cost_price || 0);
      if (costPrice > 0) {
        await journalService.postStockAdjustmentEntry(client, {
          movementId: movementRows[0].id,
          movementType: type,
          variantId,
          delta: movementQuantity,
          costPrice,
          date: new Date().toISOString().slice(0, 10),
          userId: employeeId,
        });
      }
    }

    return {
      movement: movementRows[0],
      variant: {
        id: variantId,
        productId,
        stockQty: finalAfter,
        quarantineQty: finalQuarantine,
        before,
        delta: movementQuantity,
      },
    };
  };

  const result = params.client
    ? await doWork(params.client)
    : await withTransaction(doWork);

  // Reorder check (outside the inner txn so a failure can't poison the move).
  let reorderResult = null;
  if (!skipReorderCheck) {
    try {
      reorderResult = await checkReorderThreshold(variantId);
    } catch (err) {
      console.error('[stockService] reorder check failed', err);
    }
  }

  // Socket emit: only after we know the write committed. If the caller passed
  // their own client (outer transaction), defer the emit to the caller (they
  // pass `io: null`) since we don't know whether the outer txn committed yet.
  if (io && !params.client) {
    io.emit('stock_updated', {
      productId: result.variant.productId,
      variantId: result.variant.id,
      newQty: result.variant.stockQty,
      quarantineQty: result.variant.quarantineQty,
      movementType: result.movement.movement_type,
      delta: Number(result.movement.quantity),
      changedBy: employeeId,
      timestamp: result.movement.timestamp,
      referenceType,
      referenceId,
    });
    if (reorderResult?.created) {
      io.to('role:Manager').emit('reorder_alert_created', reorderResult.payload);
      io.to('role:Admin').emit('reorder_alert_created', reorderResult.payload);
    }
  }

  return { ...result, reorderResult };
}

/**
 * Emit deferred socket notifications for stock movements applied inside an
 * outer transaction. Call this after committing the outer transaction.
 */
function emitDeferred(io, payloads = []) {
  if (!io) return;
  for (const p of payloads) {
    if (!p) continue;
    if (p.event === 'stock_updated') {
      io.emit('stock_updated', p.payload);
    } else if (p.event === 'reorder_alert_created') {
      io.to('role:Manager').emit('reorder_alert_created', p.payload);
      io.to('role:Admin').emit('reorder_alert_created', p.payload);
    }
  }
}

/**
 * Check whether a stock count is currently active for the given variant. The
 * spec blocks adjustments while a count is pending approval.
 */
async function isVariantUnderActiveCount(variantId) {
  const { rows } = await query(
    `SELECT 1
       FROM stock_count_items ci
       JOIN stock_counts c ON c.id = ci.stock_count_id
      WHERE ci.variant_id = $1
        AND c.status IN ('in_progress','draft','pending_approval')
      LIMIT 1`,
    [variantId],
  );
  return rows.length > 0;
}

module.exports = {
  applyStockMovement,
  emitDeferred,
  isVariantUnderActiveCount,
};
