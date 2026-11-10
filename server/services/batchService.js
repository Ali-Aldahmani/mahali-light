const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Inventory cost batches (cost groups) and the receipts inside them.
//
// Only stockService.applyStockMovement changes these quantities, inside the
// same transaction and after it has locked the variant row, so:
//   SUM(batch.qty_on_hand)       = variant.stock_qty
//   SUM(batch.qty_quarantined)   = variant.quarantine_qty
//   SUM(receipt.qty_on_hand)     = batch.qty_on_hand        (per batch)
//   SUM(receipt.qty_quarantined) = batch.qty_quarantined    (per batch)
// and for each receipt:
//   qty_on_hand + qty_quarantined = quantity - qty_sold + qty_returned - qty_out_other
//
// Allocation rule inside a cost group: units leave from the oldest receipt
// that still holds them (received_at, then id). Units coming back from a sale
// go to the receipt they left. Which group a sale uses is the cashier's
// choice, or the oldest group when none is chosen. None of this affects the
// accounting cost, which is the variant's weighted average (migration 061).

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

async function lockReceipts(client, batchId) {
  const { rows } = await client.query(
    `SELECT id, qty_on_hand, qty_quarantined FROM inventory_batch_receipts
      WHERE batch_id = $1 ORDER BY received_at, id FOR UPDATE`,
    [batchId],
  );
  return rows.map((r) => ({ id: r.id, onHand: Number(r.qty_on_hand), quarantined: Number(r.qty_quarantined) }));
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

// One change to one receipt (and its batch), logged against the movement.
// `counts` moves the receipt's lifetime counters: sold, returned, out_other.
async function changeReceipt(client, { batchId, receiptId, movementId, onHand = 0, quarantine = 0, counts = {}, received = false }) {
  if (!onHand && !quarantine) return;
  await client.query(
    `UPDATE inventory_batch_receipts
        SET qty_on_hand = qty_on_hand + $2,
            qty_quarantined = qty_quarantined + $3,
            qty_sold = qty_sold + $4,
            qty_returned = qty_returned + $5,
            qty_out_other = qty_out_other + $6
      WHERE id = $1`,
    [receiptId, round2(onHand), round2(quarantine), round2(counts.sold || 0),
      round2(counts.returned || 0), round2(counts.outOther || 0)],
  );
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
    `INSERT INTO inventory_batch_movements (batch_id, receipt_id, stock_movement_id, on_hand_change, quarantine_change)
     VALUES ($1, $2, $3, $4, $5)`,
    [batchId, receiptId, movementId, round2(onHand), round2(quarantine)],
  );
}

// Takes `qty` out of one batch's `field` (onHand | quarantined), oldest
// receipt first. Returns [{ receiptId, quantity }].
async function takeFromReceipts(client, batchId, qty, field) {
  const receipts = await lockReceipts(client, batchId);
  const picks = [];
  let left = round2(qty);
  for (const r of receipts) {
    if (left <= 0) break;
    const take = round2(Math.min(left, r[field]));
    if (take > 0) {
      picks.push({ receiptId: r.id, quantity: take });
      left = round2(left - take);
    }
  }
  if (left > 0.001) {
    throw new AppError(ERROR_CODES.BIZ_INSUFFICIENT_STOCK, 'Stock cannot go below zero.');
  }
  return picks;
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

async function addReceipt(client, { batchId, movementId = null, sourceType, sourceId = null, supplierId = null,
  quantity, unitCost, onHand = 0, quarantined = 0, employeeId = null }) {
  const { rows: [r] } = await client.query(
    `INSERT INTO inventory_batch_receipts
       (batch_id, stock_movement_id, source_type, source_id, supplier_id, quantity, unit_cost,
        qty_on_hand, qty_quarantined, employee_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [batchId, movementId, sourceType, sourceId, supplierId, round2(quantity), round2(unitCost),
      round2(onHand), round2(quarantined), employeeId],
  );
  return r.id;
}

// Stock recorded before batches existed, or changed outside the engine, is
// brought back in line before anything else: variant vs its batches, then
// each batch vs its receipts. Top-ups enter as an 'opening_balance' receipt
// at the current cost; excess is taken from the newest receipts.
async function healDrift(client, ctx, batches, stockBefore, quarantineBefore) {
  const fields = [['onHand', 'qty_on_hand', stockBefore], ['quarantined', 'qty_quarantined', quarantineBefore]];
  let changed = false;
  for (const [field, column, target] of fields) {
    const have = round2(batches.reduce((a, b) => a + b[field], 0));
    let extra = round2(have - target);
    if (extra > 0) {
      changed = true;
      for (const b of [...batches].reverse()) {
        if (extra <= 0) break;
        const take = round2(Math.min(extra, b[field]));
        if (take > 0) {
          await client.query(`UPDATE inventory_batches SET ${column} = ${column} - $2, updated_at = NOW() WHERE id = $1`, [b.id, take]);
          extra = round2(extra - take);
        }
      }
    } else if (extra < 0) {
      changed = true;
      const id = await batchAtCost(client, ctx);
      await client.query(`UPDATE inventory_batches SET ${column} = ${column} + $2, updated_at = NOW() WHERE id = $1`, [id, -extra]);
    }
  }
  const current = changed ? await lockBatches(client, ctx.variantId) : batches;
  for (const b of current) {
    const { rows: [sum] } = await client.query(
      `SELECT COALESCE(SUM(qty_on_hand), 0)::numeric AS on_hand, COALESCE(SUM(qty_quarantined), 0)::numeric AS held
         FROM inventory_batch_receipts WHERE batch_id = $1`, [b.id],
    );
    for (const [field, column, have] of [['onHand', 'qty_on_hand', Number(sum.on_hand)], ['quarantined', 'qty_quarantined', Number(sum.held)]]) {
      let diff = round2(b[field] - have);
      if (diff > 0) {
        await addReceipt(client, {
          batchId: b.id, sourceType: 'opening_balance', quantity: diff, unitCost: b.unitCost,
          onHand: field === 'onHand' ? diff : 0, quarantined: field === 'quarantined' ? diff : 0,
        });
      } else if (diff < 0) {
        const { rows } = await client.query(
          `SELECT id, ${column}::numeric AS q FROM inventory_batch_receipts WHERE batch_id = $1 AND ${column} > 0
            ORDER BY received_at DESC, id DESC FOR UPDATE`, [b.id],
        );
        for (const r of rows) {
          if (diff >= 0) break;
          const take = round2(Math.min(-diff, Number(r.q)));
          await client.query(
            `UPDATE inventory_batch_receipts SET ${column} = ${column} - $2, qty_out_other = qty_out_other + $2 WHERE id = $1`,
            [r.id, take],
          );
          diff = round2(diff + take);
        }
      }
    }
  }
  return current;
}

/**
 * Moves batch and receipt quantities to match one stock movement. Called by
 * applyStockMovement after it has locked the variant and written the movement.
 *
 * @returns {Promise<Array<{ batchId, receiptId, quantity, unitCost }>>} what moved
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
      for (const r of await takeFromReceipts(client, p.batchId, p.quantity, field)) {
        await changeReceipt(client, {
          batchId: p.batchId, receiptId: r.receiptId, movementId: movement.id,
          onHand: -sign * r.quantity, quarantine: sign * r.quantity,
        });
        moved.push({ batchId: p.batchId, receiptId: r.receiptId, quantity: r.quantity, unitCost: costOf.get(p.batchId) });
      }
    }
    return moved;
  }

  if (stockChange > 0) {
    let left = round2(stockChange);
    // Goods coming back from a sale return to the receipts they left.
    if (restoreFromItemId) {
      const { rows: allocations } = await client.query(
        `SELECT a.id, a.batch_id, a.receipt_id, a.quantity, a.returned_qty, b.unit_cost
           FROM inventory_batch_allocations a JOIN inventory_batches b ON b.id = a.batch_id
          WHERE a.invoice_item_id = $1 AND a.returned_qty < a.quantity
          ORDER BY a.created_at DESC, a.id DESC
          FOR UPDATE OF a`,
        [restoreFromItemId],
      );
      for (const a of allocations) {
        if (left <= 0) break;
        const take = round2(Math.min(left, Number(a.quantity) - Number(a.returned_qty)));
        if (take <= 0) continue;
        let receiptId = a.receipt_id;
        if (!receiptId) {
          // Sold before receipts were tracked: back to the group's newest receipt.
          const { rows: [r] } = await client.query(
            `SELECT id FROM inventory_batch_receipts WHERE batch_id = $1 ORDER BY received_at DESC, id DESC LIMIT 1`,
            [a.batch_id],
          );
          if (!r) continue; // no receipt to return to: comes back as a new receipt below
          receiptId = r.id;
        }
        await client.query(`UPDATE inventory_batch_allocations SET returned_qty = returned_qty + $2 WHERE id = $1`, [a.id, take]);
        await changeReceipt(client, {
          batchId: a.batch_id, receiptId, movementId: movement.id, onHand: take, counts: { returned: take },
        });
        moved.push({ batchId: a.batch_id, receiptId, quantity: take, unitCost: Number(a.unit_cost) });
        left = round2(left - take);
      }
    }
    if (left > 0) {
      const batchId = await batchAtCost(client, ctx);
      const receiptId = await addReceipt(client, {
        batchId, movementId: movement.id,
        sourceType: source?.sourceType || movement.reference_type || type,
        sourceId: source?.sourceId || movement.reference_id || null,
        supplierId: source?.supplierId || null,
        quantity: left, unitCost, employeeId,
      });
      await changeReceipt(client, { batchId, receiptId, movementId: movement.id, onHand: left, received: true });
      moved.push({ batchId, receiptId, quantity: left, unitCost: round2(unitCost) });
    }
    return moved;
  }

  if (stockChange < 0) {
    const amount = Math.abs(round2(stockChange));
    const picks = batchAllocations?.length
      ? validateSelection(batchAllocations, batches, amount, 'onHand')
      : await autoPick(client, batches, amount, 'onHand', preferSource);
    const isSale = type === 'sale';
    for (const p of picks) {
      for (const r of await takeFromReceipts(client, p.batchId, p.quantity, 'onHand')) {
        await changeReceipt(client, {
          batchId: p.batchId, receiptId: r.receiptId, movementId: movement.id, onHand: -r.quantity,
          counts: isSale ? { sold: r.quantity } : { outOther: r.quantity },
        });
        // A sale always records its batches and receipts; a line created after
        // its stock moved (an edit adding a product) is linked once it exists.
        if (invoiceItemId || isSale) {
          await client.query(
            `INSERT INTO inventory_batch_allocations
               (batch_id, receipt_id, stock_movement_id, invoice_item_id, quantity, unit_cost)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [p.batchId, r.receiptId, movement.id, invoiceItemId, r.quantity, costOf.get(p.batchId)],
          );
        }
        moved.push({ batchId: p.batchId, receiptId: r.receiptId, quantity: r.quantity, unitCost: costOf.get(p.batchId) });
      }
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
              'qtyOnHand', r.qty_on_hand::float8, 'qtyQuarantined', r.qty_quarantined::float8,
              'qtySold', r.qty_sold::float8, 'qtyReturned', r.qty_returned::float8,
              'qtyOutOther', r.qty_out_other::float8,
              'unitCost', r.unit_cost::float8, 'receivedAt', r.received_at
            ) ORDER BY r.received_at, r.id) FILTER (WHERE r.id IS NOT NULL), '[]') AS receipts
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
