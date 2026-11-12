const { withTransaction, query } = require('../db/postgres');
const { todayStoreDate, storeDate } = require('../utils/dates');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { applyStockMovement } = require('./stockService');
const { nextDocumentNumber } = require('../utils/docNumbers');
const journalService = require('./journalService');
const { logActivity } = require('../utils/activityLog');
const { runOnce } = require('../utils/operations');

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

// Line cost defaults to the last purchase price (the average cost before any
// purchase); only callers with cost visibility may override (negotiated
// supplier pricing).
async function resolvePoLineCost(client, { variantId, productId = null, clientCost, canOverrideCost }) {
  const { rows } = await client.query(
    `SELECT COALESCE(last_purchase_cost, cost_price) AS cost_price, product_id FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product variant not found.', {
      status: 404,
    });
  }
  // Stock moves on the variant, but the movement and cost history are filed
  // under this product, so a mismatched pair would misfile them.
  if (productId && rows[0].product_id !== productId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'That variant belongs to a different product.', { status: 400 });
  }
  const catalogCost = money(rows[0].cost_price);
  if (!canOverrideCost) return catalogCost;
  const requested = money(clientCost);
  if (!Number.isFinite(requested) || requested < 0) return catalogCost;
  return requested;
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

// What goods sent back on a PO take off what is owed, through either return
// flow. Rejected or replaced returns came back, so they don't count. VAT
// included: the return reverses it too, and the PO total includes it.
async function returnedValueOf(client, poId) {
  const { rows: [row] } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(total_value), 0) FROM supplier_returns
         WHERE purchase_order_id = $1
           AND COALESCE(resolution, '') NOT IN ('rejected', 'replaced'))::float8
       + (SELECT COALESCE(SUM(total_value), 0) FROM return_orders
           WHERE original_po_id = $1 AND return_type = 'supplier_return')::float8 AS value,
       po.subtotal, po.tax_amount
       FROM purchase_orders po WHERE po.id = $1`,
    [poId],
  );
  if (!row) return 0;
  const value = Number(row.value) || 0;
  const subtotal = Number(row.subtotal) || 0;
  const vat = subtotal > 0 ? value * (Number(row.tax_amount) || 0) / subtotal : 0;
  return money(value + vat);
}

// Compute and persist totals on the purchase_orders row from its items.
// What is owed is net of goods sent back (review 5 Nov), so paying the net
// amount marks the PO paid instead of leaving it partial and overdue.
async function recalculatePOTotals(client, poId) {
  const { rows } = await client.query(
    // A closed remainder (quantity_cancelled) is not part of the order any more.
    `SELECT COALESCE(SUM((quantity - quantity_cancelled) * cost_price_per_unit), 0)::numeric AS subtotal
       FROM purchase_order_items WHERE purchase_order_id = $1`,
    [poId],
  );
  const subtotal = money(rows[0].subtotal);
  const taxAmount = await resolvePoTaxAmount(client, subtotal);
  const totalCost = money(subtotal + taxAmount);
  const owed = money(totalCost - await returnedValueOf(client, poId));

  await client.query(
    `UPDATE purchase_orders
        SET subtotal = $1,
            tax_amount = $2,
            total_cost = $3,
            balance_due = $5 - COALESCE(amount_paid, 0),
            -- Recomputed with the total, so a draft edited after a payment
            -- doesn't keep a stale status. Nothing paid is always 'unpaid'
            -- (an empty draft isn't "paid").
            payment_status = CASE
              WHEN COALESCE(amount_paid, 0) <= 0 THEN 'unpaid'
              WHEN $5 - amount_paid <= 0.0001 THEN 'paid'
              ELSE 'partial' END,
            updated_at = NOW()
      WHERE id = $4`,
    [subtotal, taxAmount, totalCost, poId, owed],
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

// When the goods arrived, as entered by the person receiving them (supplier
// delivery audit P0). Not in the future, and not before the order was sent.
function resolveDeliveredAt(deliveredAt, po) {
  if (deliveredAt == null || deliveredAt === '') return { at: new Date(), source: 'defaulted' };
  const at = new Date(deliveredAt);
  if (Number.isNaN(at.getTime())) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The delivery time is not a valid date.', { status: 400 });
  }
  if (at.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The delivery time can’t be in the future.', { status: 400 });
  }
  if (po.confirmed_at && at.getTime() < new Date(po.confirmed_at).getTime()) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The delivery time can’t be before the order was sent to the supplier.', { status: 400 });
  }
  return { at, source: 'entered' };
}

async function receiveItems({ poId, items, employeeId, requestKey = null, deliveredAt = null, deliveryNote = null }) {
  if (!Array.isArray(items) || !items.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Provide at least one item to receive.',
      { status: 400 },
    );
  }

  const receive = async (client) => {
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

    const delivered = resolveDeliveredAt(deliveredAt, po);
    // One receipt per delivery; created with its first line.
    let receiptId = null;
    const receiptFor = async () => {
      if (!receiptId) {
        const { rows: [r] } = await client.query(
          `INSERT INTO purchase_order_receipts
             (purchase_order_id, supplier_id, delivered_at, delivered_at_source, recorded_by, delivery_note)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [poId, po.supplier_id || null, delivered.at, delivered.source, employeeId, deliveryNote || null],
        );
        receiptId = r.id;
      }
      return receiptId;
    };

    const affectedVariants = [];
    const costChanges = [];
    // What this receipt added to the books, the sum of its stock movements.
    let bookValueReceived = 0;
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
      // What was closed as never coming can't be received any more.
      const ordered = Number(item.quantity) - Number(item.quantity_cancelled || 0);
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
      const { rows: [beforeRow] } = await client.query(
        `SELECT cost_price FROM product_variants WHERE id = $1`, [item.variant_id],
      );
      const { valueChange: receivedBook } = await applyStockMovement({
        client,
        variantId: item.variant_id,
        productId: item.product_id,
        type: 'purchase',
        quantity: recvQty,
        unitCost: item.cost_price_per_unit,
        referenceType: 'purchase_order',
        referenceId: poId,
        batchSource: { sourceType: 'purchase_order', sourceId: poId, supplierId: po.supplier_id || null },
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
      // Expiry date of these goods, when they have one (data readiness 2026-11-12).
      let expiry = null;
      if (i.expiryDate) {
        expiry = String(i.expiryDate).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The expiry date is not a valid date.', { status: 400 });
        }
        if (expiry < storeDate(delivered.at)) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED,
            `The expiry date for ${item.variant_id} is before the goods arrived.`, { status: 400 });
        }
      }
      await client.query(
        `INSERT INTO purchase_order_receipt_lines (receipt_id, purchase_order_item_id, variant_id, quantity, expiry_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [await receiptFor(), i.id, item.variant_id, recvQty, expiry],
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

      // Weighted average (migration 061): the receipt adds what it cost to the
      // book value, and the engine has recomputed the average. The latest
      // purchase price is kept for display; history is in product_cost_history.
      bookValueReceived = money(bookValueReceived + receivedBook);
      const newCost = Number(item.cost_price_per_unit);
      if (newCost > 0) {
        await client.query(
          `UPDATE product_variants SET last_purchase_cost = $1 WHERE id = $2`,
          [newCost, item.variant_id],
        );
      }
      const { rows: [afterRow] } = await client.query(
        `SELECT cost_price FROM product_variants WHERE id = $1`, [item.variant_id],
      );
      const currentCost = Number(beforeRow?.cost_price || 0);
      if (Math.abs(currentCost - Number(afterRow.cost_price)) > 0.001) {
        costChanges.push({
          variantId: item.variant_id,
          productId: item.product_id,
          oldCost: currentCost,
          newCost: Number(afterRow.cost_price),
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
      `SELECT quantity, quantity_received, quantity_cancelled FROM purchase_order_items
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
    // received_date is the day the last goods arrived (store time), not the
    // day the last receipt was typed in.
    await client.query(
      `UPDATE purchase_orders
          SET status = $1::varchar,
              received_date = CASE WHEN $1::varchar = 'received' THEN
                (SELECT MAX(delivered_at)::date FROM purchase_order_receipts WHERE purchase_order_id = $2)
                ELSE received_date END,
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
        bookValue: bookValueReceived,
        vatAmount: receivedVat,
        userId: employeeId,
      });
    }

    // The receipt's audit entry commits with the stock and journal it records.
    await logActivity({
      client,
      entityType: 'purchase_order',
      entityId: poId,
      action: 'purchase_order.received',
      performedBy: employeeId,
      notes: `Received ${items.length} line${items.length === 1 ? '' : 's'}`,
    });

    return {
      po: updatedPo[0],
      affectedVariants,
      costChanges,
    };
  };
  // A retry with the same request key returns the first receipt instead of
  // adding the same goods to stock twice (a partial receipt would otherwise
  // be accepted again while the order still had quantity left).
  const payload = {
    poId, deliveredAt: deliveredAt || null,
    items: items.map((it) => ({ id: it.id, quantityReceived: Number(it.quantityReceived), expiryDate: it.expiryDate || null })),
  };
  return withTransaction(async (client) => {
    const { result, replayed } = await runOnce(
      client,
      { scope: 'po_receipt', key: requestKey, userId: employeeId, payload },
      () => receive(client),
    );
    return { ...result, replayed };
  });
}

// Close what the supplier will never deliver (supplier delivery audit P0):
// each line's outstanding quantity becomes cancelled, the order is complete
// as of its last delivery, and it is owed only for what arrived.
async function closeRemainder({ poId, reason, userId }) {
  return withTransaction(async (client) => {
    const { rows: [po] } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`, [poId]);
    if (!po) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    if (po.status === 'confirmed') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
        'Nothing has been received on this order yet. Cancel it instead.', { status: 409 });
    }
    if (po.status !== 'partially_received') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
        `Only a partly received order has a remainder to close (this one is "${po.status}").`, { status: 409 });
    }
    const { rows: [after] } = await client.query(
      `SELECT COALESCE(SUM(quantity_received * cost_price_per_unit), 0)::numeric AS subtotal
         FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]);
    const subtotal = money(after.subtotal);
    const newTotal = money(subtotal + await resolvePoTaxAmount(client, subtotal));
    const owed = money(newTotal - await returnedValueOf(client, poId));
    if (Number(po.amount_paid || 0) > owed + 0.0001) {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
        `${Number(po.amount_paid).toFixed(2)} has been paid but only ${owed.toFixed(2)} was delivered. Reverse the extra payment first.`,
        { status: 409 });
    }
    const { rows: closed } = await client.query(
      `UPDATE purchase_order_items SET quantity_cancelled = quantity - quantity_received
        WHERE purchase_order_id = $1 AND quantity - quantity_received - quantity_cancelled > 0
        RETURNING id, quantity - quantity_received AS cancelled`, [poId]);
    await recalculatePOTotals(client, poId);
    await client.query(
      `UPDATE purchase_orders
          SET status = 'received',
              received_date = (SELECT MAX(delivered_at)::date FROM purchase_order_receipts WHERE purchase_order_id = $1),
              short_closed_at = NOW(), short_closed_by = $2, short_close_reason = $3, updated_at = NOW()
        WHERE id = $1`, [poId, userId, reason]);
    await logActivity({
      client, entityType: 'purchase_order', entityId: poId, action: 'purchase_order.remainder_closed',
      performedBy: userId, oldValue: { status: po.status },
      newValue: { status: 'received', lines: closed.map((c) => ({ id: c.id, cancelled: Number(c.cancelled) })) },
      notes: `${po.po_number}: ${reason}`,
    });
    const { rows: [updated] } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1`, [poId]);
    return updated;
  });
}

// A delivery date promised for an order. History is append-only; the first
// supplier promise is the original and never changes.
async function addPromise(client, { po, promisedDate, source, note = null, userId }) {
  const d = String(promisedDate).slice(0, 10);
  const orderDay = storeDate(po.order_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The promised date is not a valid date.', { status: 400 });
  }
  if (d < orderDay) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A delivery date can’t be before the order date.', { status: 400 });
  }
  await client.query(
    `INSERT INTO purchase_order_promises (purchase_order_id, promised_date, source, recorded_by, note)
     VALUES ($1,$2::date,$3,$4,$5)`, [po.id, d, source, userId, note]);
  if (source === 'supplier') {
    await client.query(
      `UPDATE purchase_orders
          SET promised_date = $2::date,
              original_promised_date = COALESCE(original_promised_date, $2::date),
              updated_at = NOW()
        WHERE id = $1`, [po.id, d]);
  }
}

async function recordSupplierPromise({ poId, promisedDate, note, userId }) {
  return withTransaction(async (client) => {
    const { rows: [po] } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`, [poId]);
    if (!po) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    if (!['confirmed', 'partially_received'].includes(po.status)) {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
        'A supplier’s delivery date can be recorded once the order is sent and until it is complete.', { status: 409 });
    }
    await addPromise(client, { po, promisedDate, source: 'supplier', note, userId });
    await logActivity({
      client, entityType: 'purchase_order', entityId: poId, action: 'purchase_order.promise_recorded',
      performedBy: userId, oldValue: { promisedDate: po.promised_date }, newValue: { promisedDate }, notes: note,
    });
    const { rows: [updated] } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1`, [poId]);
    return updated;
  });
}

module.exports = {
  closeRemainder,
  addPromise,
  recordSupplierPromise,
  returnedValueOf,
  assertReturnFitsPurchaseOrder,
  generatePoNumber,
  recalculatePOTotals,
  resolvePoTaxAmount,
  resolvePoLineCost,
  receiveItems,
};
