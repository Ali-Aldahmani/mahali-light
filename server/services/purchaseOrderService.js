const { withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { applyStockMovement } = require('./stockService');
const { nextDocumentNumber } = require('../utils/docNumbers');

// Round to 2 decimals (currency) to avoid floating-point drift.
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function generatePoNumber(client) {
  const result = await nextDocumentNumber(client, 'PO');
  return result.formatted;
}

// Compute and persist totals on the purchase_orders row from its items.
async function recalculatePOTotals(client, poId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity * cost_price_per_unit), 0)::numeric AS subtotal
       FROM purchase_order_items WHERE purchase_order_id = $1`,
    [poId],
  );
  const subtotal = money(rows[0].subtotal);

  await client.query(
    `UPDATE purchase_orders
        SET subtotal = $1,
            total_cost = $1 + COALESCE(tax_amount, 0),
            balance_due = ($1 + COALESCE(tax_amount, 0)) - COALESCE(amount_paid, 0),
            updated_at = NOW()
      WHERE id = $2`,
    [subtotal, poId],
  );
}

// Receive items against a PO. Items: [{ id, quantityReceived }].
// All work is atomic and stock movements are routed through applyStockMovement.
// Returns { po, affectedVariants, costChanges } for the caller to emit sockets.
async function receiveItems({ poId, items, employeeId }) {
  if (!Array.isArray(items) || !items.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Provide at least one item to receive.',
      { status: 400 },
    );
  }

  return withTransaction(async (client) => {
    // Lock the PO so concurrent receives can't race.
    const { rows: poRows } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [poId],
    );
    if (!poRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const po = poRows[0];
    if (!['confirmed', 'partially_received'].includes(po.status)) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot receive items on a PO in status "${po.status}".`,
        { status: 409 },
      );
    }

    const affectedVariants = [];
    const costChanges = [];

    for (const i of items) {
      if (!i.id || !Number.isFinite(Number(i.quantityReceived))) continue;
      const recvQty = Number(i.quantityReceived);
      if (recvQty <= 0) continue;

      const { rows: itemRows } = await client.query(
        `SELECT * FROM purchase_order_items
          WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`,
        [i.id, poId],
      );
      if (!itemRows.length) {
        throw new AppError(
          ERROR_CODES.RESOURCE_NOT_FOUND,
          `PO item ${i.id} not found.`,
          { status: 404 },
        );
      }
      const item = itemRows[0];
      const ordered = Number(item.quantity);
      const alreadyReceived = Number(item.quantity_received);
      if (alreadyReceived + recvQty > ordered + 1e-6) {
        throw new AppError(
          ERROR_CODES.BIZ_RECEIVE_EXCEEDS_ORDER,
          `Cannot receive ${recvQty}; only ${(ordered - alreadyReceived).toFixed(2)} remaining for this item.`,
          {
            status: 409,
            details: {
              itemId: i.id,
              ordered,
              alreadyReceived,
              requested: recvQty,
            },
          },
        );
      }

      // Apply the stock movement via the central engine. We're inside an
      // outer transaction so we reuse the client and skip the engine's own
      // socket emit (we emit a single aggregate `po_received` afterwards).
      await applyStockMovement({
        client,
        variantId: item.variant_id,
        productId: item.product_id,
        type: 'purchase',
        quantity: recvQty,
        referenceType: 'purchase_order',
        referenceId: poId,
        employeeId,
        notes: `Receiving PO ${po.po_number}`,
        skipReorderCheck: true,
      });

      // Update the line received qty.
      await client.query(
        `UPDATE purchase_order_items
            SET quantity_received = quantity_received + $1
          WHERE id = $2`,
        [recvQty, i.id],
      );

      // Cost history record for every receive.
      await client.query(
        `INSERT INTO product_cost_history
           (product_id, variant_id, purchase_order_id, supplier_id,
            cost_price, quantity_bought, employee_id, date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE)`,
        [
          item.product_id,
          item.variant_id,
          poId,
          po.supplier_id,
          item.cost_price_per_unit,
          recvQty,
          employeeId,
        ],
      );

      // If the cost per unit is different from the variant's current
      // cost_price, update the variant and remember the change for logging.
      const { rows: variantRows } = await client.query(
        `SELECT cost_price FROM product_variants WHERE id = $1`,
        [item.variant_id],
      );
      const currentCost = Number(variantRows[0]?.cost_price || 0);
      const newCost = Number(item.cost_price_per_unit);
      if (Math.abs(currentCost - newCost) > 0.001) {
        await client.query(
          `UPDATE product_variants
              SET cost_price = $1, updated_at = NOW()
            WHERE id = $2`,
          [newCost, item.variant_id],
        );
        costChanges.push({
          variantId: item.variant_id,
          productId: item.product_id,
          oldCost: currentCost,
          newCost,
        });
      }

      affectedVariants.push(item.variant_id);
    }

    // Re-read item state to compute new PO status.
    const { rows: allItems } = await client.query(
      `SELECT quantity, quantity_received FROM purchase_order_items
        WHERE purchase_order_id = $1`,
      [poId],
    );
    const fullyReceived = allItems.every(
      (it) => Number(it.quantity_received) >= Number(it.quantity) - 1e-6,
    );
    const anyReceived = allItems.some(
      (it) => Number(it.quantity_received) > 0,
    );

    const nextStatus = fullyReceived
      ? 'received'
      : anyReceived
        ? 'partially_received'
        : po.status;

    await client.query(
      `UPDATE purchase_orders
          SET status = $1,
              received_date = CASE WHEN $1 = 'received' THEN CURRENT_DATE ELSE received_date END,
              updated_at = NOW()
        WHERE id = $2`,
      [nextStatus, poId],
    );

    const { rows: updatedPo } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1`,
      [poId],
    );

    return {
      po: updatedPo[0],
      affectedVariants,
      costChanges,
    };
  });
}

module.exports = {
  generatePoNumber,
  recalculatePOTotals,
  receiveItems,
};
