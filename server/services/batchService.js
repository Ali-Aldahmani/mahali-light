const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Inventory cost batches. Only stockService.applyStockMovement changes batch
// quantities, inside the same transaction and after it has locked the
// variant row, so the batch totals always equal the variant's stock_qty and
// quarantine_qty. See migration 059.

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function lockBatches(client, variantId) {
  const { rows } = await client.query(
    `SELECT id, unit_cost, qty_on_hand, qty_quarantined
       FROM inventory_batches
      WHERE variant_id = $1
      ORDER BY first_received_at, id
      FOR UPDATE`,
    [variantId],
  );
  return rows.map((b) => ({
    id: b.id,
    unitCost: Number(b.unit_cost),
    onHand: Number(b.qty_on_hand),
    quarantined: Number(b.qty_quarantined),
  }));
}

// A batch for this cost, created empty when the variant has none at it yet.
async function batchAtCost(client, { variantId, productId, unitCost }) {
  const { rows } = await client.query(
    `INSERT INTO inventory_batches (product_id, variant_id, unit_cost)
     VALUES ($1, $2, $3)
     ON CONFLICT (variant_id, unit_cost) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [productId, variantId, round2(unitCost)],
  );
  return rows[0].id;
}

async function changeBatch(client, batchId, movementId, { onHand = 0, quarantine = 0, received = false }) {
  if (!onHand && !quarantine) return;
  await client.query(
    `UPDATE inventory_batches
        SET qty_on_hand = qty_on_hand + $2,
            qty_quarantined = qty_quarantined + $3,
            last_received_at = CASE WHEN $4 THEN NOW() ELSE last_received_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [batchId, round2(onHand), round2(quarantine), received],
  );
  await client.query(
    `INSERT INTO inventory_batch_movements (batch_id, stock_movement_id, on_hand_change, quarantine_change)
     VALUES ($1, $2, $3, $4)`,
    [batchId, movementId, round2(onHand), round2(quarantine)],
  );
}

// Checks a caller's [{ batchId, quantity }] against the locked batches and
// merges repeated batch ids. `field` is the quantity being taken from.
function validateSelection(selection, batches, total, field) {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const merged = new Map();
  for (const s of selection) {
    const qty = round2(s.quantity);
    if (!s.batchId || !(qty > 0)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Each batch choice needs a batch and a quantity above zero.');
    }
    if (!byId.has(s.batchId)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A chosen batch does not belong to this product.');
    }
    merged.set(s.batchId, round2((merged.get(s.batchId) || 0) + qty));
  }
  const sum = round2([...merged.values()].reduce((a, b) => a + b, 0));
  if (sum !== round2(total)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      `The batch quantities add up to ${sum}, but the line is for ${round2(total)}.`);
  }
  for (const [id, qty] of merged) {
    const available = byId.get(id)[field];
    if (qty > available + 0.001) {
      throw new AppError(ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
        `Not enough in the chosen batch. Available: ${available}, requested: ${qty}.`,
        { details: { batchId: id, available, requested: qty } });
    }
  }
  return [...merged].map(([batchId, quantity]) => ({ batchId, quantity }));
}

// Oldest first, with batches received from `preferSource` ahead of the rest.
async function autoPick(client, batches, total, field, preferSource) {
  let ordered = batches;
  if (preferSource?.sourceId) {
    const { rows } = await client.query(
      `SELECT DISTINCT batch_id FROM inventory_batch_receipts
        WHERE source_type = $1 AND source_id = $2 AND batch_id = ANY($3)`,
      [preferSource.sourceType, preferSource.sourceId, batches.map((b) => b.id)],
    );
    const preferred = new Set(rows.map((r) => r.batch_id));
    ordered = [...batches.filter((b) => preferred.has(b.id)), ...batches.filter((b) => !preferred.has(b.id))];
  }
  const picks = [];
  let left = round2(total);
  for (const b of ordered) {
    if (left <= 0) break;
    const take = round2(Math.min(left, b[field]));
    if (take > 0) {
      picks.push({ batchId: b.id, quantity: take });
      left = round2(left - take);
    }
  }
  if (left > 0.001) {
    throw new AppError(ERROR_CODES.BIZ_INSUFFICIENT_STOCK, 'Stock cannot go below zero.');
  }
  return picks;
}

// Stock recorded before batches existed, or changed outside the engine, is
// brought back in line as a batch at the current cost before anything else.
async function healDrift(client, ctx, batches, stockBefore, quarantineBefore) {
  const onHand = round2(batches.reduce((a, b) => a + b.onHand, 0));
  const held = round2(batches.reduce((a, b) => a + b.quarantined, 0));
  const missingOnHand = round2(stockBefore - onHand);
  const missingHeld = round2(quarantineBefore - held);
  if (missingOnHand === 0 && missingHeld === 0) return batches;
  if (missingOnHand < 0 || missingHeld < 0) {
    // More in batches than in stock: trim the newest batches.
    for (const [field, column, missing] of [['onHand', 'qty_on_hand', missingOnHand], ['quarantined', 'qty_quarantined', missingHeld]]) {
      let extra = -missing;
      for (const b of [...batches].reverse()) {
        if (extra <= 0) break;
        const take = round2(Math.min(extra, b[field]));
        if (take > 0) {
          await client.query(`UPDATE inventory_batches SET ${column} = ${column} - $2, updated_at = NOW() WHERE id = $1`, [b.id, take]);
          extra = round2(extra - take);
        }
      }
    }
  }
  const topUpOnHand = Math.max(0, missingOnHand);
  const topUpHeld = Math.max(0, missingHeld);
  if (topUpOnHand || topUpHeld) {
    const id = await batchAtCost(client, ctx);
    await client.query(
      `UPDATE inventory_batches SET qty_on_hand = qty_on_hand + $2, qty_quarantined = qty_quarantined + $3, updated_at = NOW()
        WHERE id = $1`,
      [id, topUpOnHand, topUpHeld],
    );
    await client.query(
      `INSERT INTO inventory_batch_receipts (batch_id, source_type, quantity, unit_cost) VALUES ($1, 'opening_balance', $2, $3)`,
      [id, round2(topUpOnHand + topUpHeld), round2(ctx.unitCost)],
    );
  }
  return lockBatches(client, ctx.variantId);
}

/**
 * Moves batch quantities to match one stock movement. Called by
 * applyStockMovement after it has locked the variant and written the movement.
 *
 * @returns {Promise<Array<{ batchId, quantity, unitCost }>>} what moved, per batch
 */
async function applyBatchMovement(client, {
  variantId, productId, type, movement, stockBefore, quarantineBefore, stockChange,
  unitCost, batchAllocations = null, restoreFromItemId = null, invoiceItemId = null,
  source = null, preferSource = null, employeeId = null,
}) {
  const ctx = { variantId, productId, unitCost };
  let batches = await lockBatches(client, variantId);
  batches = await healDrift(client, ctx, batches, stockBefore, quarantineBefore);
  const costOf = new Map(batches.map((b) => [b.id, b.unitCost]));
  const moved = [];

  if (type === 'quarantine' || type === 'quarantine_release') {
    const amount = Math.abs(round2(stockChange));
    const field = type === 'quarantine' ? 'onHand' : 'quarantined';
    const picks = batchAllocations?.length
      ? validateSelection(batchAllocations, batches, amount, field)
      : await autoPick(client, batches, amount, field, preferSource);
    const sign = type === 'quarantine' ? 1 : -1;
    for (const p of picks) {
      await changeBatch(client, p.batchId, movement.id, { onHand: -sign * p.quantity, quarantine: sign * p.quantity });
      moved.push({ batchId: p.batchId, quantity: p.quantity, unitCost: costOf.get(p.batchId) });
    }
    return moved;
  }

  if (stockChange > 0) {
    let left = round2(stockChange);
    // Goods coming back from a sale return to the batches they left.
    if (restoreFromItemId) {
      const { rows: allocations } = await client.query(
        `SELECT id, batch_id, quantity, returned_qty FROM inventory_batch_allocations
          WHERE invoice_item_id = $1 AND returned_qty < quantity
          ORDER BY created_at DESC, id DESC
          FOR UPDATE`,
        [restoreFromItemId],
      );
      for (const a of allocations) {
        if (left <= 0) break;
        const take = round2(Math.min(left, Number(a.quantity) - Number(a.returned_qty)));
        if (take <= 0) continue;
        await client.query(`UPDATE inventory_batch_allocations SET returned_qty = returned_qty + $2 WHERE id = $1`, [a.id, take]);
        await changeBatch(client, a.batch_id, movement.id, { onHand: take });
        const { rows: [b] } = await client.query(`SELECT unit_cost FROM inventory_batches WHERE id = $1`, [a.batch_id]);
        moved.push({ batchId: a.batch_id, quantity: take, unitCost: Number(b.unit_cost) });
        left = round2(left - take);
      }
    }
    if (left > 0) {
      const id = await batchAtCost(client, ctx);
      await changeBatch(client, id, movement.id, { onHand: left, received: !restoreFromItemId });
      if (!restoreFromItemId) {
        await client.query(
          `INSERT INTO inventory_batch_receipts
             (batch_id, stock_movement_id, source_type, source_id, supplier_id, quantity, unit_cost, employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, movement.id, source?.sourceType || movement.reference_type || type,
            source?.sourceId || movement.reference_id || null, source?.supplierId || null,
            left, round2(unitCost), employeeId],
        );
      }
      moved.push({ batchId: id, quantity: left, unitCost: round2(unitCost) });
    }
    return moved;
  }

  if (stockChange < 0) {
    const amount = Math.abs(round2(stockChange));
    const picks = batchAllocations?.length
      ? validateSelection(batchAllocations, batches, amount, 'onHand')
      : await autoPick(client, batches, amount, 'onHand', preferSource);
    for (const p of picks) {
      await changeBatch(client, p.batchId, movement.id, { onHand: -p.quantity });
      // A sale always records its batches; a line created after its stock moved
      // (an edit adding a product) is linked once it exists.
      if (invoiceItemId || type === 'sale') {
        await client.query(
          `INSERT INTO inventory_batch_allocations (batch_id, stock_movement_id, invoice_item_id, quantity, unit_cost)
           VALUES ($1, $2, $3, $4, $5)`,
          [p.batchId, movement.id, invoiceItemId, p.quantity, costOf.get(p.batchId)],
        );
      }
      moved.push({ batchId: p.batchId, quantity: p.quantity, unitCost: costOf.get(p.batchId) });
    }
  }
  return moved;
}

// Batches of a variant (or several), with their receipts. Cost is left out
// unless the viewer may see it, and suppliers and documents unless they may
// see suppliers (a cashier picking a batch gets number, date and quantity).
async function listBatches({ variantIds, includeEmpty = false, includeCost = false, includeSuppliers = false }) {
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.product_id, b.variant_id, b.unit_cost,
            b.qty_on_hand::float8 AS qty_on_hand, b.qty_quarantined::float8 AS qty_quarantined,
            b.first_received_at, b.last_received_at,
            COALESCE(json_agg(json_build_object(
              'id', r.id, 'sourceType', r.source_type, 'sourceId', r.source_id,
              'supplierId', r.supplier_id, 'supplierName', s.name,
              'documentNumber', po.po_number, 'quantity', r.quantity::float8,
              'unitCost', r.unit_cost::float8, 'receivedAt', r.received_at
            ) ORDER BY r.received_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS receipts
       FROM inventory_batches b
       LEFT JOIN inventory_batch_receipts r ON r.batch_id = b.id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON r.source_type = 'purchase_order' AND po.id = r.source_id
      WHERE b.variant_id = ANY($1)
        AND ($2 OR b.qty_on_hand > 0 OR b.qty_quarantined > 0)
      GROUP BY b.id
      ORDER BY b.variant_id, b.first_received_at, b.id`,
    [variantIds, includeEmpty],
  );
  return rows.map((b) => {
    const receipts = b.receipts.map((r) => ({
      ...r,
      unitCost: includeCost ? r.unitCost : undefined,
      ...(includeSuppliers ? {} : { supplierId: undefined, supplierName: undefined, documentNumber: undefined, sourceId: undefined }),
    }));
    const suppliers = [...new Set(receipts.map((r) => r.supplierName).filter(Boolean))];
    return {
      id: b.id,
      batchNumber: b.batch_number,
      productId: b.product_id,
      variantId: b.variant_id,
      qtyOnHand: b.qty_on_hand,
      qtyQuarantined: b.qty_quarantined,
      firstReceivedAt: b.first_received_at,
      lastReceivedAt: b.last_received_at,
      suppliers,
      receipts,
      ...(includeCost ? {
        unitCost: Number(b.unit_cost),
        value: round2(Number(b.unit_cost) * b.qty_on_hand),
      } : {}),
    };
  });
}

// Validates a draft line's batch choice without locking: the batches belong
// to the variant and the quantities add up. Availability is checked again,
// under lock, at confirm.
async function checkSelection(client, variantId, selection, quantity) {
  if (selection == null) return null;
  if (!Array.isArray(selection) || !selection.length) return null;
  const { rows } = await client.query(
    `SELECT id FROM inventory_batches WHERE variant_id = $1`, [variantId],
  );
  const batches = rows.map((r) => ({ id: r.id, onHand: Infinity }));
  return validateSelection(selection, batches, quantity, 'onHand');
}

module.exports = { applyBatchMovement, listBatches, checkSelection };
