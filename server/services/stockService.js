const { query, withTransaction } = require('../db/postgres');
const { todayStoreDate } = require('../utils/dates');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { assertQuantity } = require('../utils/quantity');
const { checkReorderThreshold } = require('./reorderService');
const { applyBatchMovement } = require('./batchService');
const journalService = require('./journalService');
const notificationService = require('./notificationService');
const { emitEvent } = require('../socket/events');

// Movement types that require an inventory-vs-equity journal entry. Sales +
// purchases + quarantine moves are excluded — those flow through invoice /
// PO receive / refund entries and posting again here would double-count.
const ADJUSTMENT_JOURNAL_TYPES = new Set([
  // Decision (review 5 Nov): stock entered as opening stock is the owner's
  // investment, so it is booked like an adjustment (inventory against owner
  // equity). It entered stock with no ledger entry before.
  'opening_stock',
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
    // What one unit of this movement is worth (inventory audit INV-007): the
    // receipt cost, or the cost a sale was booked at. Defaults to the
    // product's cost right now.
    unitCost = null,
    // Cost batches (see batchService). An outgoing or quarantine movement can
    // name the batches it takes from, [{ batchId, quantity }]; otherwise the
    // oldest are used, preferring those received from `preferSource`. A sale
    // passes its invoiceItemId so the batches it used are recorded; goods
    // coming back from a line pass restoreFromItemId to return to them.
    batchAllocations = null,
    invoiceItemId = null,
    restoreFromItemId = null,
    batchSource = null,
    preferSource = null,
    // Weighted average valuation (migration 061). Incoming goods are valued
    // at unitCost (receipts) or the current average. Goods coming back from a
    // sale or a supplier return pass valueOverride: the exact book value they
    // left at, so the journal that reverses the original posting matches.
    // Outgoing goods always leave at the average; unitCost is ignored for them.
    valueOverride = null,
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
      `SELECT id, product_id, stock_qty, quarantine_qty, cost_price, inventory_value,
              (SELECT COALESCE(SUM(b.qty_on_hand + b.qty_quarantined), 0)
                 FROM inventory_batches b WHERE b.variant_id = product_variants.id) AS batched_held
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
      `SELECT name, unit_label, sold_by FROM products WHERE id = $1`,
      [productId],
    );
    const unitLabel = prodRows[0]?.unit_label || null;
    // Inventory audit INV-004: every stock change follows the sales quantity
    // rule, whichever screen it came from.
    assertQuantity(Math.abs(delta), {
      soldBy: prodRows[0]?.sold_by, name: prodRows[0]?.name || 'item', allowZero: true,
    });

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
          { details: { available: before, requested: amount } },
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
              details: { available: before, requested: Math.abs(delta) },
            },
          );
        }
        // For non-sale types we still refuse to go negative.
        throw new AppError(
          ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
          'Stock cannot go below zero.',
        );
      }
    }

    // Round to the columns' two decimals to avoid floating-point drift.
    const rounded = (n) => Math.round(n * 100) / 100;
    const finalAfter = rounded(after);
    const finalQuarantine = rounded(newQuarantine);

    // --- Book value (weighted average) -------------------------------------
    const heldBefore = rounded(before + beforeQuarantine);
    const heldAfter = rounded(finalAfter + finalQuarantine);
    let bookBefore = rounded(Number(row.inventory_value || 0));
    // Stock that reached the variant outside this engine (an import, a direct
    // edit) has no book value. The batch layer folds it into a batch at the
    // current cost; it enters the books the same way, against owner equity
    // like any stock adjustment, so the ledger keeps matching.
    const outsideBooks = row.batched_held == null ? 0 : rounded(heldBefore - Number(row.batched_held));
    if (outsideBooks !== 0) {
      const bookedBefore = rounded(heldBefore - outsideBooks);
      const unit = outsideBooks > 0 || bookedBefore <= 0
        ? Number(row.cost_price || 0)
        : bookBefore / bookedBefore;
      const healValue = outsideBooks > 0
        ? rounded(outsideBooks * unit)
        : -Math.min(bookBefore, rounded(-outsideBooks * unit));
      if (healValue !== 0) {
        bookBefore = rounded(bookBefore + healValue);
        await client.query(`UPDATE product_variants SET inventory_value = $2 WHERE id = $1`, [variantId, bookBefore]);
        const inv = await journalService.getAccountIdByCode('1004', client);
        const equity = await journalService.getAccountIdByCode('3001', client);
        await journalService.postJournalEntryWith(client, {
          referenceType: 'variant_cost',
          referenceId: variantId,
          date: todayStoreDate(),
          description: `Stock of ${outsideBooks} recorded outside the stock engine brought onto the books`,
          userId: employeeId,
          lines: healValue > 0
            ? [{ accountId: inv, debit: healValue, credit: 0 }, { accountId: equity, debit: 0, credit: healValue }]
            : [{ accountId: equity, debit: -healValue, credit: 0 }, { accountId: inv, debit: 0, credit: -healValue }],
        });
      }
    }
    const average = heldBefore > 0 ? bookBefore / heldBefore : Number(row.cost_price || 0);
    const averageUnit = rounded(average);
    const heldChange = rounded(heldAfter - heldBefore);
    let valueChange = 0;
    if (heldChange > 0) {
      valueChange = valueOverride != null
        ? rounded(Math.abs(Number(valueOverride)))
        : rounded(heldChange * Number(unitCost ?? averageUnit));
    } else if (heldChange < 0) {
      // Emptying the variant takes its whole remaining value, so no rounding
      // residue is left on the books.
      valueChange = heldAfter <= 0
        ? -bookBefore
        : -Math.min(bookBefore, rounded(-heldChange * averageUnit));
    }
    const bookAfter = rounded(bookBefore + valueChange);
    // One unit's value for this movement, for its record and cost batches.
    const movementCost = heldChange > 0
      ? rounded(valueChange / heldChange)
      : heldChange < 0 ? averageUnit : rounded(Number(unitCost ?? averageUnit));
    const costAfter = heldAfter > 0 ? rounded(bookAfter / heldAfter) : Number(row.cost_price || 0);

    await client.query(
      `UPDATE product_variants
          SET stock_qty = $1,
              quarantine_qty = $2,
              inventory_value = $4,
              cost_price = $5,
              updated_at = NOW()
        WHERE id = $3`,
      [finalAfter, finalQuarantine, variantId, bookAfter, costAfter],
    );

    // Persisted quantity for the movement row uses the actual signed delta
    // (positive for IN, negative for OUT). For quarantine* moves we use the
    // unsigned amount with a sign that matches the stock_qty change.
    const movementQuantity = ['quarantine', 'quarantine_release'].includes(type)
      ? finalAfter - before
      : delta;

    // clock_timestamp(), not the column's NOW() default (= transaction start):
    // stamped while this row lock is held, so ordering against a stock-count
    // line's counted_at (also stamped under the row lock) is exact — see
    // stockCountsController.approve.
    const { rows: movementRows } = await client.query(
      `INSERT INTO stock_movements
         (product_id, variant_id, movement_type, quantity, qty_before, qty_after,
          reference_type, reference_id, unit_label, employee_id, notes, unit_cost, value_change, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, clock_timestamp())
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
        movementCost,
        valueChange,
      ],
    );

    const batches = await applyBatchMovement(client, {
      variantId,
      productId,
      type,
      movement: movementRows[0],
      stockBefore: before,
      quarantineBefore: beforeQuarantine,
      stockChange: rounded(finalAfter - before),
      // Receipts keep what the goods were bought at; anything else enters a
      // group at its value per unit.
      unitCost: type === 'purchase' && unitCost != null ? rounded(Number(unitCost)) : movementCost,
      batchAllocations,
      invoiceItemId,
      restoreFromItemId,
      source: batchSource,
      preferSource,
      employeeId,
    });

    // Stock adjustments + count corrections post inventory ↔ equity, at the
    // same cost the movement records, so the two always agree.
    if (ADJUSTMENT_JOURNAL_TYPES.has(type) && valueChange !== 0) {
      await journalService.postStockAdjustmentEntry(client, {
        movementId: movementRows[0].id,
        movementType: type,
        variantId,
        delta: movementQuantity,
        costPrice: movementCost,
        value: valueChange,
        date: todayStoreDate(),
        userId: employeeId,
      });
    }

    return {
      movement: movementRows[0],
      batches,
      // The book value this movement added (+) or removed (-).
      valueChange,
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

  // Reorder check. When the caller supplied their own client (an outer,
  // still-open transaction), run the check through that SAME client so it
  // sees this movement's own uncommitted write instead of stale pre-commit
  // data from the shared pool — otherwise a sale that empties a caller-owned
  // transaction's last unit could read the pre-sale stock_qty and silently
  // skip (or wrongly clear) the reorder alert. When we own the transaction
  // ourselves (no params.client), it's already committed by this point, so
  // using the pool here is fine and keeps a reorder-check failure from being
  // able to poison the move.
  //
  // Inside the caller's transaction the check runs under a savepoint: a
  // failing statement would otherwise leave that whole transaction aborted,
  // and the sale would fail later with an unrelated error (engineering audit
  // F-TX-04). The savepoint undoes only the check.
  let reorderResult = null;
  if (!skipReorderCheck) {
    const outer = params.client;
    try {
      if (outer) await outer.query('SAVEPOINT reorder_check');
      reorderResult = await checkReorderThreshold(variantId, outer);
      if (outer) await outer.query('RELEASE SAVEPOINT reorder_check');
    } catch (err) {
      console.error('[stockService] reorder check failed', err);
      reorderResult = null;
      if (outer) {
        await outer.query('ROLLBACK TO SAVEPOINT reorder_check');
        await outer.query('RELEASE SAVEPOINT reorder_check');
      }
    }
  }

  // Socket emit: only after we know the write committed. If the caller passed
  // their own client (outer transaction), defer the emit to the caller (they
  // pass `io: null`) since we don't know whether the outer txn committed yet.
  if (io && !params.client) {
    emitEvent(io, 'stock_updated', {
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
      emitEvent(io, 'reorder_alert_created', reorderResult.payload);
      emitLowStockNotification(reorderResult.payload).catch(() => {});
    }
  }

  return { ...result, reorderResult };
}

// Emits a stock.low_stock / stock.out_of_stock notification. Called from
// both the inline emit path and the deferred-emit path. Uses a per-variant
// dedupe key so rapid sales don't spam the notification panel.
async function emitLowStockNotification(payload) {
  if (!payload || !payload.variantId) return;
  const isOut = Number(payload.currentStock || 0) <= 0;
  const type = isOut ? 'stock.out_of_stock' : 'stock.low_stock';
  await notificationService.notifyManagersAndAdmins({
    type,
    category: 'stock',
    severity: isOut ? 'error' : 'warning',
    title: isOut
      ? `Out of stock: ${payload.productName || 'product'}`
      : `Low stock: ${payload.productName || 'product'}`,
    message: isOut
      ? `Stock has dropped to zero.`
      : `Stock at ${payload.currentStock} ${payload.unitLabel || ''} (threshold ${payload.reorderPoint ?? ''}).`.trim(),
    referenceType: 'product',
    referenceId: payload.productId || null,
    actionUrl: payload.productId ? `/products/${payload.productId}` : `/inventory`,
    dedupeKey: `stock.alert.${payload.variantId}`,
  });
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
      emitEvent(io, 'stock_updated', p.payload);
    } else if (p.event === 'reorder_alert_created') {
      emitEvent(io, 'reorder_alert_created', p.payload);
      emitLowStockNotification(p.payload).catch(() => {});
    }
  }
}

/**
 * Sets a variant's cost by hand (weighted average, migration 061). With stock
 * on hand this revalues it: the book value becomes quantity x the new cost,
 * and the difference is posted against owner equity, the way stock
 * adjustments are, so the ledger keeps matching. Logged by the caller.
 * Returns { revalued, difference }.
 */
async function revalueVariantCost(client, { variantId, newCost, userId = null }) {
  const { rows: [v] } = await client.query(
    `SELECT id, stock_qty, quarantine_qty, inventory_value, cost_price FROM product_variants WHERE id = $1 FOR UPDATE`,
    [variantId],
  );
  if (!v) return { revalued: false, difference: 0 };
  const round = (n) => Math.round(Number(n) * 100) / 100;
  const held = round(Number(v.stock_qty) + Number(v.quarantine_qty));
  const cost = round(newCost);
  if (held <= 0) {
    await client.query(`UPDATE product_variants SET cost_price = $2, updated_at = NOW() WHERE id = $1`, [variantId, cost]);
    return { revalued: false, difference: 0 };
  }
  const value = round(held * cost);
  const difference = round(value - Number(v.inventory_value));
  await client.query(
    `UPDATE product_variants SET cost_price = $2, inventory_value = $3, updated_at = NOW() WHERE id = $1`,
    [variantId, cost, value],
  );
  if (difference !== 0) {
    const inv = await journalService.getAccountIdByCode('1004', client);
    const equity = await journalService.getAccountIdByCode('3001', client);
    await journalService.postJournalEntryWith(client, {
      referenceType: 'variant_cost',
      referenceId: variantId,
      date: todayStoreDate(),
      description: `Cost corrected to ${cost.toFixed(2)} on ${held} units`,
      userId,
      lines: difference > 0
        ? [{ accountId: inv, debit: difference, credit: 0 }, { accountId: equity, debit: 0, credit: difference }]
        : [{ accountId: equity, debit: -difference, credit: 0 }, { accountId: inv, debit: 0, credit: -difference }],
    });
  }
  return { revalued: true, difference };
}

/**
 * Lock several variants in one fixed order (by id). Every transaction that
 * moves stock on more than one variant calls this first, so two of them can't
 * each hold one variant while waiting for the other's.
 */
async function lockVariants(client, variantIds) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, product_id, stock_qty FROM product_variants
      WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return rows;
}

/**
 * Serialises starting a stock count against applying an adjustment. Both take
 * this transaction lock before their check, so a count can't start between an
 * adjustment's check and its stock move, and two counts can't both start.
 */
async function lockStockCounts(client) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('stock_counts', 0))`);
}

/**
 * Check whether a stock count is currently active for the given variant. The
 * spec blocks adjustments while a count is pending approval. Pass the
 * transaction client (after lockStockCounts) when the answer guards a write.
 */
async function isVariantUnderActiveCount(variantId, client = null) {
  const { rows } = await (client ? client.query.bind(client) : query)(
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
  revalueVariantCost,
  emitDeferred,
  isVariantUnderActiveCount,
  lockStockCounts,
  lockVariants,
};
