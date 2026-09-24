const { withTransaction, query } = require('../db/postgres');
const { todayStoreDate } = require('../utils/dates');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { applyStockMovement } = require('./stockService');
const { nextDocumentNumber } = require('../utils/docNumbers');
const journalService = require('./journalService');

// Round to 2 decimals (currency) to avoid floating-point drift.
function money(n) {
  n = Number(n) || 0;
  // Math.round(n*100)/100 alone mis-rounds values that land exactly on a
  // half-cent boundary due to IEEE-754 float representation (e.g. 2.90*0.05
  // is stored as 0.14499999999999999, rounding down to 0.14 instead of 0.15).
  // A tiny epsilon nudges genuine .xx5 boundaries the right way without
  // affecting any other value.
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

async function generatePoNumber(client) {
  const result = await nextDocumentNumber(client, 'PO');
  return result.formatted;
}

// Purchase-order VAT follows the same store settings as sales invoices —
// never trust a client-supplied taxAmount.
async function resolvePoTaxAmount(client, subtotal) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT vat_enabled, vat_rate FROM app_settings ORDER BY id LIMIT 1`,
  );
  const row = rows[0];
  if (!row || row.vat_enabled === false) return 0;
  const rate = Number(row.vat_rate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return money(subtotal * (rate / 100));
}

// Line cost defaults to catalog cost_price; only callers with cost visibility
// may override (negotiated supplier pricing).
async function resolvePoLineCost(client, { variantId, clientCost, canOverrideCost }) {
  const { rows } = await client.query(
    `SELECT cost_price FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product variant not found.', {
      status: 404,
    });
  }
  const catalogCost = money(rows[0].cost_price);
  if (!canOverrideCost) return catalogCost;
  const requested = money(clientCost);
  if (!Number.isFinite(requested) || requested < 0) return catalogCost;
  return requested;
}

// Compute and persist totals on the purchase_orders row from its items.
async function recalculatePOTotals(client, poId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity * cost_price_per_unit), 0)::numeric AS subtotal
       FROM purchase_order_items WHERE purchase_order_id = $1`,
    [poId],
  );
  const subtotal = money(rows[0].subtotal);
  const taxAmount = await resolvePoTaxAmount(client, subtotal);
  const totalCost = money(subtotal + taxAmount);

  await client.query(
    `UPDATE purchase_orders
        SET subtotal = $1,
            tax_amount = $2,
            total_cost = $3,
            balance_due = $3 - COALESCE(amount_paid, 0),
            updated_at = NOW()
      WHERE id = $4`,
    [subtotal, taxAmount, totalCost, poId],
  );
}

// Receive items against a PO. Items: [{ id, quantityReceived }].
// All work is atomic and stock movements are routed through applyStockMovement.
// Returns { po, affectedVariants, costChanges } for the caller to emit sockets.
// Net value received so far on a PO (quantity_received × unit cost).
async function receivedValueOf(client, poId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity_received * cost_price_per_unit), 0)::numeric AS value
       FROM purchase_order_items WHERE purchase_order_id = $1`,
    [poId],
  );
  return money(rows[0].value);
}

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
    // Track value received in this call to post a single journal entry below.
    let receivedValue = 0;
    const receivedValueBefore = await receivedValueOf(client, poId);

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

      receivedValue = money(receivedValue + recvQty * Number(item.cost_price_per_unit));

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

    // Input VAT for what arrived in this call: the PO's VAT (tax_amount, on
    // subtotal) allocated by received value. Cumulative — VAT through the
    // new received value minus VAT through the old — so partial receipts
    // of a fully received PO sum to exactly tax_amount, with no rounding
    // drift. vat_amount keeps a running total of input VAT booked.
    const receivedValueAfter = await receivedValueOf(client, poId);
    const vatThrough = (value) => {
      const subtotal = Number(po.subtotal) || 0;
      if (subtotal <= 0) return 0;
      return money((Number(po.tax_amount) || 0) * Math.min(value, subtotal) / subtotal);
    };
    const receivedVat = money(vatThrough(receivedValueAfter) - vatThrough(receivedValueBefore));
    await client.query(
      `UPDATE purchase_orders SET vat_amount = $1 WHERE id = $2`,
      [vatThrough(receivedValueAfter), poId],
    );

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

    // $1 is cast explicitly: used both as the varchar status and in a text
    // comparison, Postgres rejected it ("inconsistent types deduced for
    // parameter $1", 42P08), so every receive failed with a 500.
    await client.query(
      `UPDATE purchase_orders
          SET status = $1::varchar,
              received_date = CASE WHEN $1::varchar = 'received' THEN CURRENT_DATE ELSE received_date END,
              updated_at = NOW()
        WHERE id = $2`,
      [nextStatus, poId],
    );

    const { rows: updatedPo } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1`,
      [poId],
    );

    // DR Inventory + DR input VAT (2002), CR Payables for the gross amount —
    // supplier payments are capped at total_cost (VAT-inclusive), so posting
    // payables net of VAT drove them negative, and input VAT was never
    // recorded anywhere (vat_amount was never written; the VAT report read 0).
    if (receivedValue > 0 || receivedVat > 0) {
      await journalService.postPurchaseReceiveEntry(client, {
        poId,
        poNumber: po.po_number,
        date: todayStoreDate(),
        inventoryValue: receivedValue,
        vatAmount: receivedVat,
        userId: employeeId,
      });
    }

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
  resolvePoTaxAmount,
  resolvePoLineCost,
  receiveItems,
};
