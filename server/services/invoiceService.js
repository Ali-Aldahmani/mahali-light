const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { applyStockMovement } = require('./stockService');
const { assertWithinCreditLimit } = require('./customerService');
const { logActivity } = require('../utils/activityLog');

const DEFAULT_TAX_RATE = 5.0;

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function clampNonNegative(n) {
  const v = money(n);
  return v < 0 ? 0 : v;
}

// Sanitize a PC identifier ("PC-1", "pc 2", "p1") into the compact form used
// inside invoice numbers (P1, P2). Anything not alphanumeric is stripped.
function shortenPcCode(raw) {
  if (!raw) return 'P0';
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return 'P0';
  return s.length > 6 ? s.slice(0, 6) : s;
}

// Generate the next invoice number for the given PC. Format:
//   INV-{YEAR}-{PC_CODE}-{SEQ5}
// e.g. INV-2026-P1-00042. Sequences are per (year × PC).
async function generateInvoiceNumber(client, { year, pcIdentifier }) {
  const pc = shortenPcCode(pcIdentifier);
  const { formatted } = await nextDocumentNumber(client, 'INV', year, {
    scope: pc,
    padWidth: 5,
  });
  return { invoiceNumber: formatted, pcCode: pc };
}

// Compute totals from items + payments + invoice-level discount/tax rate.
function computeTotals({ items, payments, invoiceDiscount = 0, taxRate = DEFAULT_TAX_RATE }) {
  const subtotal = items.reduce(
    (sum, it) => sum + money(Number(it.quantity) * Number(it.unit_price)),
    0,
  );
  const itemDiscount = items.reduce(
    (sum, it) => sum + money(it.discount_amount || 0),
    0,
  );
  const invDisc = clampNonNegative(invoiceDiscount || 0);
  const discount = money(itemDiscount + invDisc);
  const taxable = clampNonNegative(money(subtotal - discount));
  const tax = money(taxable * (Number(taxRate) / 100));
  const total = money(taxable + tax);
  const amountPaid = payments.reduce(
    (sum, p) => sum + money(p.amount || 0),
    0,
  );
  const balanceDue = clampNonNegative(money(total - amountPaid));
  let paymentStatus = 'unpaid';
  if (balanceDue <= 0.001 && amountPaid > 0.001) paymentStatus = 'paid';
  else if (amountPaid > 0.001) paymentStatus = 'partial';

  return {
    subtotal: money(subtotal),
    discountAmount: discount,
    invoiceDiscount: invDisc,
    taxableAmount: taxable,
    taxRate: Number(taxRate),
    taxAmount: tax,
    total,
    amountPaid: money(amountPaid),
    balanceDue,
    paymentStatus,
  };
}

// Compute per-line subtotal/total honouring percent OR amount discount.
function computeLineFigures(item) {
  const qty = money(item.quantity);
  const unit = money(item.unit_price);
  const subtotal = money(qty * unit);
  let discountAmount = money(item.discount_amount || 0);
  const discountPercent = Number(item.discount_percent || 0);
  if (discountPercent > 0 && !discountAmount) {
    discountAmount = money(subtotal * (discountPercent / 100));
  }
  if (discountAmount > subtotal) discountAmount = subtotal;
  const total = money(subtotal - discountAmount);
  return { lineSubtotal: subtotal, lineTotal: total, discountAmount };
}

// Persist the cart items for a draft invoice. Removes existing rows and
// inserts the new ones. Snapshots product_name/variant_attributes/sku from
// product_variants at this moment so a draft re-save reflects current data.
async function replaceItems(client, invoiceId, items) {
  await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  let position = 0;
  for (const raw of items) {
    if (!raw.variant_id) continue;
    const { rows: variantRows } = await client.query(
      `SELECT v.id, v.product_id, v.sku, v.cost_price, v.selling_price,
              p.name AS product_name, p.unit_label
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1`,
      [raw.variant_id],
    );
    if (!variantRows.length) {
      throw new AppError(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Variant ${raw.variant_id} not found.`,
        { status: 404 },
      );
    }
    const v = variantRows[0];

    const { rows: attrRows } = await client.query(
      `SELECT a.name, a.unit, av.value
         FROM product_variant_attributes pva
         JOIN product_attribute_values av ON av.id = pva.attribute_value_id
         JOIN product_attributes a ON a.id = av.attribute_id
        WHERE pva.variant_id = $1`,
      [raw.variant_id],
    );
    const variantAttrs = attrRows.reduce((acc, r) => {
      acc[r.name] = r.unit ? `${r.value}${r.unit}` : r.value;
      return acc;
    }, {});

    const item = {
      quantity: money(raw.quantity),
      unit_price: money(raw.unit_price ?? v.selling_price),
      discount_amount: money(raw.discount_amount || 0),
      discount_percent: Number(raw.discount_percent || 0),
    };
    const figures = computeLineFigures(item);

    await client.query(
      `INSERT INTO invoice_items (
        invoice_id, product_id, variant_id, product_name, variant_attributes,
        sku, unit_label, quantity, unit_price, cost_price_at_time,
        discount_percent, discount_amount, line_subtotal, line_total, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        invoiceId,
        v.product_id,
        v.id,
        v.product_name,
        JSON.stringify(variantAttrs),
        v.sku,
        v.unit_label || 'pcs',
        item.quantity,
        item.unit_price,
        money(v.cost_price || 0),
        item.discount_percent,
        figures.discountAmount,
        figures.lineSubtotal,
        figures.lineTotal,
        position++,
      ],
    );
  }
}

async function loadItemsForInvoice(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY position ASC, created_at ASC`,
    [invoiceId],
  );
  return rows;
}

async function loadPaymentsForInvoice(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY timestamp ASC`,
    [invoiceId],
  );
  return rows;
}

// Recompute and persist invoice totals on the row itself. Used after items
// or payments change. Returns the totals object.
async function recalculateAndPersistTotals(
  client,
  invoiceId,
  { invoiceDiscount = null, taxRate = null } = {},
) {
  const { rows: invRows } = await client.query(
    `SELECT invoice_discount, tax_rate FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  if (!invRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Invoice not found.', {
      status: 404,
    });
  }
  const items = await loadItemsForInvoice(client, invoiceId);
  const payments = await loadPaymentsForInvoice(client, invoiceId);

  const totals = computeTotals({
    items,
    payments,
    invoiceDiscount:
      invoiceDiscount != null ? invoiceDiscount : invRows[0].invoice_discount,
    taxRate: taxRate != null ? taxRate : invRows[0].tax_rate,
  });

  await client.query(
    `UPDATE invoices
        SET subtotal = $1,
            discount_amount = $2,
            invoice_discount = $3,
            taxable_amount = $4,
            tax_rate = $5,
            tax_amount = $6,
            total = $7,
            amount_paid = $8,
            balance_due = $9,
            payment_status = $10,
            updated_at = NOW()
      WHERE id = $11`,
    [
      totals.subtotal,
      totals.discountAmount,
      totals.invoiceDiscount,
      totals.taxableAmount,
      totals.taxRate,
      totals.taxAmount,
      totals.total,
      totals.amountPaid,
      totals.balanceDue,
      totals.paymentStatus,
      invoiceId,
    ],
  );
  return totals;
}

// Verify each invoice item still has enough on-hand stock to be sold. Returns
// a list of shortfalls so the caller can build a useful error response.
async function findStockShortfalls(client, items) {
  if (!items.length) return [];
  const ids = items.map((i) => i.variant_id);
  const { rows } = await client.query(
    `SELECT id, product_id, stock_qty FROM product_variants WHERE id = ANY($1) FOR UPDATE`,
    [ids],
  );
  const stockMap = new Map(rows.map((r) => [r.id, Number(r.stock_qty)]));
  const shortfalls = [];
  for (const it of items) {
    const have = stockMap.get(it.variant_id);
    if (have == null) {
      shortfalls.push({
        variantId: it.variant_id,
        productName: it.product_name,
        sku: it.sku,
        available: 0,
        requested: Number(it.quantity),
      });
      continue;
    }
    if (have + 0.0001 < Number(it.quantity)) {
      shortfalls.push({
        variantId: it.variant_id,
        productName: it.product_name,
        sku: it.sku,
        available: have,
        requested: Number(it.quantity),
      });
    }
  }
  return shortfalls;
}

// Confirm a draft invoice — the heart of the POS flow. Atomically:
//   1. validates stock for every line
//   2. applies stock movements (sale)
//   3. validates payments (credit needs customer + within limit)
//   4. updates customer credit_balance when credit is used
//   5. recomputes totals server-side
//   6. transitions status → confirmed
//   7. writes invoice_history + activity_log
//
// Returns { invoice, items, payments, totals } so the caller can emit
// sockets with the right payload and persist the response.
async function confirmInvoice({ invoiceId, employeeId, io = null }) {
  const result = await withTransaction(async (client) => {
    const { rows: invRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId],
    );
    if (!invRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Invoice not found.', {
        status: 404,
      });
    }
    const invoice = invRows[0];
    if (invoice.status !== 'draft') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Only draft invoices can be confirmed (current: ${invoice.status}).`,
        { status: 409 },
      );
    }

    const items = await loadItemsForInvoice(client, invoiceId);
    if (!items.length) {
      throw new AppError(
        ERROR_CODES.BIZ_INVOICE_EMPTY,
        undefined,
        { status: 409 },
      );
    }

    const shortfalls = await findStockShortfalls(client, items);
    if (shortfalls.length) {
      throw new AppError(
        ERROR_CODES.BIZ_INSUFFICIENT_STOCK,
        `Not enough stock for ${shortfalls.length} item(s).`,
        { status: 409, details: { shortfalls } },
      );
    }

    // Apply stock movements. We deliberately pass io: null so the emit fires
    // after we commit the outer transaction.
    const stockEmits = [];
    for (const it of items) {
      const { variant } = await applyStockMovement({
        client,
        variantId: it.variant_id,
        productId: it.product_id,
        type: 'sale',
        quantity: it.quantity,
        referenceType: 'invoice',
        referenceId: invoiceId,
        employeeId,
        unitLabel: it.unit_label,
        skipReorderCheck: false,
        io: null,
      });
      stockEmits.push({
        event: 'stock_updated',
        payload: {
          productId: variant.productId,
          variantId: variant.id,
          newQty: variant.stockQty,
          quarantineQty: variant.quarantineQty,
          movementType: 'sale',
          delta: variant.delta,
          changedBy: employeeId,
          timestamp: new Date().toISOString(),
          referenceType: 'invoice',
          referenceId: invoiceId,
        },
      });
    }

    // Resolve payments. Credit requires a customer and respect of credit_limit.
    const payments = await loadPaymentsForInvoice(client, invoiceId);
    let creditUsed = 0;
    for (const pm of payments) {
      if (pm.method === 'credit') {
        if (!invoice.customer_id) {
          throw new AppError(ERROR_CODES.BIZ_GUEST_NO_CREDIT, undefined, {
            status: 409,
          });
        }
        creditUsed += money(pm.amount);
      }
    }
    if (creditUsed > 0) {
      await assertWithinCreditLimit(client, invoice.customer_id, creditUsed);
      await client.query(
        `UPDATE customers
            SET credit_balance = credit_balance + $1,
                updated_at = NOW()
          WHERE id = $2`,
        [creditUsed, invoice.customer_id],
      );
    }

    const totals = await recalculateAndPersistTotals(client, invoiceId);

    await client.query(
      `UPDATE invoices
          SET status = 'confirmed',
              confirmed_by = $1,
              confirmed_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [employeeId, invoiceId],
    );

    await client.query(
      `INSERT INTO invoice_history (invoice_id, action, performed_by, new_snapshot, notes)
       VALUES ($1, 'confirmed', $2, $3::jsonb, $4)`,
      [
        invoiceId,
        employeeId,
        JSON.stringify({ totals, itemCount: items.length }),
        `Confirmed by employee.`,
      ],
    );

    const { rows: finalRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [invoiceId],
    );

    return {
      invoice: finalRows[0],
      items,
      payments,
      totals,
      creditUsed,
      stockEmits,
    };
  });

  await logActivity({
    entityType: 'invoice',
    entityId: invoiceId,
    action: 'invoice.confirmed',
    performedBy: employeeId,
    newValue: { total: result.totals.total },
    notes: `Invoice ${result.invoice.invoice_number} confirmed`,
  });

  // Deferred socket emits. Stock first, then invoice_confirmed, then credit
  // delta if any.
  if (io) {
    for (const e of result.stockEmits) {
      io.emit(e.event, e.payload);
    }
    const payload = {
      invoiceId,
      invoiceNumber: result.invoice.invoice_number,
      total: result.totals.total,
      customerId: result.invoice.customer_id,
      createdBy: result.invoice.created_by,
      confirmedBy: employeeId,
      pcIdentifier: result.invoice.pc_identifier,
      at: new Date().toISOString(),
    };
    io.to('role:Manager').emit('invoice_confirmed', payload);
    io.to('role:Admin').emit('invoice_confirmed', payload);

    if (result.creditUsed > 0 && result.invoice.customer_id) {
      const { rows: cRows } = await query(
        `SELECT credit_balance, name FROM customers WHERE id = $1`,
        [result.invoice.customer_id],
      );
      if (cRows.length) {
        const creditPayload = {
          customerId: result.invoice.customer_id,
          customerName: cRows[0].name,
          newBalance: Number(cRows[0].credit_balance),
          deltaAmount: result.creditUsed,
          method: 'invoice_credit',
          changedBy: employeeId,
          at: new Date().toISOString(),
        };
        io.to('role:Manager').emit('customer_balance_updated', creditPayload);
        io.to('role:Admin').emit('customer_balance_updated', creditPayload);
      }
    }
  }

  return result;
}

// Cancel a confirmed (or draft) invoice. Reverses stock movements via
// applyStockMovement('return_in') and reverses any credit charged to the
// customer. Draft invoices have no side-effects to reverse.
async function cancelInvoice({ invoiceId, employeeId, reason = null, io = null }) {
  const result = await withTransaction(async (client) => {
    const { rows: invRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId],
    );
    if (!invRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const invoice = invRows[0];
    if (invoice.status === 'cancelled') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Invoice already cancelled.',
        { status: 409 },
      );
    }
    if (invoice.has_return) {
      throw new AppError(
        ERROR_CODES.BIZ_INVOICE_LOCKED,
        'Cannot cancel an invoice with a recorded return.',
        { status: 409 },
      );
    }

    const stockEmits = [];
    if (invoice.status === 'confirmed') {
      const items = await loadItemsForInvoice(client, invoiceId);
      for (const it of items) {
        const { variant } = await applyStockMovement({
          client,
          variantId: it.variant_id,
          productId: it.product_id,
          type: 'return_in',
          quantity: it.quantity,
          referenceType: 'invoice_cancel',
          referenceId: invoiceId,
          employeeId,
          io: null,
          skipReorderCheck: true,
        });
        stockEmits.push({
          event: 'stock_updated',
          payload: {
            productId: variant.productId,
            variantId: variant.id,
            newQty: variant.stockQty,
            quarantineQty: variant.quarantineQty,
            movementType: 'return_in',
            delta: variant.delta,
            changedBy: employeeId,
            timestamp: new Date().toISOString(),
            referenceType: 'invoice_cancel',
            referenceId: invoiceId,
          },
        });
      }

      // Reverse credit charged to customer.
      if (invoice.customer_id) {
        const { rows: paymentRows } = await client.query(
          `SELECT COALESCE(SUM(amount), 0)::numeric AS credit_used
             FROM invoice_payments
            WHERE invoice_id = $1 AND method = 'credit'`,
          [invoiceId],
        );
        const credit = money(paymentRows[0].credit_used);
        if (credit > 0) {
          await client.query(
            `UPDATE customers
                SET credit_balance = GREATEST(0, credit_balance - $1),
                    updated_at = NOW()
              WHERE id = $2`,
            [credit, invoice.customer_id],
          );
        }
      }
    }

    await client.query(
      `UPDATE invoices
          SET status = 'cancelled',
              cancelled_by = $1,
              cancelled_at = NOW(),
              cancel_reason = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [employeeId, reason, invoiceId],
    );

    await client.query(
      `INSERT INTO invoice_history (invoice_id, action, performed_by, notes)
       VALUES ($1, 'cancelled', $2, $3)`,
      [invoiceId, employeeId, reason || 'Cancelled.'],
    );

    return { invoice, stockEmits };
  });

  await logActivity({
    entityType: 'invoice',
    entityId: invoiceId,
    action: 'invoice.cancelled',
    performedBy: employeeId,
    notes: reason || null,
  });

  if (io) {
    for (const e of result.stockEmits) io.emit(e.event, e.payload);
    const payload = {
      invoiceId,
      invoiceNumber: result.invoice.invoice_number,
      cancelledBy: employeeId,
      at: new Date().toISOString(),
    };
    io.to('role:Manager').emit('invoice_cancelled', payload);
    io.to('role:Admin').emit('invoice_cancelled', payload);
  }

  return result;
}

// Apply an approved edit request. The simplest supported shapes:
//   { items: [{ variant_id, quantity, unit_price, discount_amount? }] }
//   { invoiceDiscount: <number> }
//   { notes: <string> }
//
// For confirmed invoices, item changes trigger stock deltas: increase qty →
// extra sale movement (with stock check), decrease qty → return_in movement.
// Credit payment totals are NOT touched automatically — the cashier should
// add or void payments separately after the edit is applied.
async function applyEditRequest({ requestId, managerId, io = null }) {
  const result = await withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT * FROM invoice_edit_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!reqRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const req = reqRows[0];
    if (req.status !== 'pending') {
      throw new AppError(
        ERROR_CODES.BIZ_EDIT_REQUEST_ALREADY_REVIEWED,
        undefined,
        { status: 409 },
      );
    }

    const { rows: invRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [req.invoice_id],
    );
    if (!invRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const invoice = invRows[0];
    if (invoice.has_return || invoice.status === 'cancelled') {
      throw new AppError(
        ERROR_CODES.BIZ_INVOICE_LOCKED,
        'Invoice can no longer be edited.',
        { status: 409 },
      );
    }

    const changes = req.changes || {};
    const stockEmits = [];

    // ---- Item changes (only meaningful for confirmed invoices) -----------
    if (Array.isArray(changes.items) && invoice.status === 'confirmed') {
      const { rows: currentItems } = await client.query(
        `SELECT * FROM invoice_items WHERE invoice_id = $1`,
        [req.invoice_id],
      );
      const byVariant = new Map(currentItems.map((r) => [r.variant_id, r]));
      for (const requested of changes.items) {
        const cur = byVariant.get(requested.variant_id);
        const newQty = money(requested.quantity);
        const oldQty = cur ? Number(cur.quantity) : 0;
        const delta = money(newQty - oldQty);
        if (Math.abs(delta) > 0.0001) {
          if (delta > 0) {
            const { variant } = await applyStockMovement({
              client,
              variantId: requested.variant_id,
              type: 'sale',
              quantity: delta,
              referenceType: 'invoice_edit',
              referenceId: req.invoice_id,
              employeeId: managerId,
              io: null,
              skipReorderCheck: true,
            });
            stockEmits.push({ event: 'stock_updated', payload: emitPayload(variant, 'sale', managerId, req.invoice_id) });
          } else {
            const { variant } = await applyStockMovement({
              client,
              variantId: requested.variant_id,
              type: 'return_in',
              quantity: Math.abs(delta),
              referenceType: 'invoice_edit',
              referenceId: req.invoice_id,
              employeeId: managerId,
              io: null,
              skipReorderCheck: true,
            });
            stockEmits.push({ event: 'stock_updated', payload: emitPayload(variant, 'return_in', managerId, req.invoice_id) });
          }
        }
        const newPrice =
          requested.unit_price != null ? money(requested.unit_price) : Number(cur?.unit_price);
        const newDisc =
          requested.discount_amount != null
            ? money(requested.discount_amount)
            : Number(cur?.discount_amount || 0);

        const lineSubtotal = money(newQty * newPrice);
        const lineTotal = money(lineSubtotal - newDisc);

        if (cur) {
          if (newQty <= 0) {
            await client.query(`DELETE FROM invoice_items WHERE id = $1`, [
              cur.id,
            ]);
          } else {
            await client.query(
              `UPDATE invoice_items
                  SET quantity = $1, unit_price = $2, discount_amount = $3,
                      line_subtotal = $4, line_total = $5
                WHERE id = $6`,
              [newQty, newPrice, newDisc, lineSubtotal, lineTotal, cur.id],
            );
          }
        }
      }
    }

    // ---- Invoice-level adjustments ---------------------------------------
    if (changes.invoiceDiscount != null) {
      await client.query(
        `UPDATE invoices SET invoice_discount = $1 WHERE id = $2`,
        [money(changes.invoiceDiscount), req.invoice_id],
      );
    }
    if (changes.notes != null) {
      await client.query(`UPDATE invoices SET notes = $1 WHERE id = $2`, [
        changes.notes,
        req.invoice_id,
      ]);
    }

    const totals = await recalculateAndPersistTotals(client, req.invoice_id);

    await client.query(
      `UPDATE invoice_edit_requests
          SET status = 'approved',
              reviewed_by = $1,
              reviewed_at = NOW()
        WHERE id = $2`,
      [managerId, requestId],
    );

    await client.query(
      `INSERT INTO invoice_history (invoice_id, action, performed_by, new_snapshot, notes)
       VALUES ($1, 'edit_applied', $2, $3::jsonb, $4)`,
      [
        req.invoice_id,
        managerId,
        JSON.stringify({ changes, totals }),
        `Edit request ${requestId} approved.`,
      ],
    );

    return { request: req, invoice, totals, stockEmits };
  });

  await logActivity({
    entityType: 'invoice',
    entityId: result.request.invoice_id,
    action: 'invoice.edit_applied',
    performedBy: managerId,
  });

  if (io) {
    for (const e of result.stockEmits) io.emit(e.event, e.payload);
    io.emit('edit_request_reviewed', {
      requestId,
      invoiceId: result.request.invoice_id,
      status: 'approved',
      reviewedBy: managerId,
      requestedBy: result.request.requested_by,
      at: new Date().toISOString(),
    });
  }
  return result;
}

function emitPayload(variant, type, employeeId, refId) {
  return {
    productId: variant.productId,
    variantId: variant.id,
    newQty: variant.stockQty,
    quarantineQty: variant.quarantineQty,
    movementType: type,
    delta: variant.delta,
    changedBy: employeeId,
    timestamp: new Date().toISOString(),
    referenceType: 'invoice_edit',
    referenceId: refId,
  };
}

// Reject an edit request.
async function rejectEditRequest({ requestId, managerId, reason, io = null }) {
  const { rows } = await query(
    `SELECT status, invoice_id, requested_by FROM invoice_edit_requests WHERE id = $1`,
    [requestId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
      status: 404,
    });
  }
  if (rows[0].status !== 'pending') {
    throw new AppError(
      ERROR_CODES.BIZ_EDIT_REQUEST_ALREADY_REVIEWED,
      undefined,
      { status: 409 },
    );
  }

  await query(
    `UPDATE invoice_edit_requests
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            rejection_reason = $2
      WHERE id = $3`,
    [managerId, reason || null, requestId],
  );

  await query(
    `INSERT INTO invoice_history (invoice_id, action, performed_by, notes)
     VALUES ($1, 'edit_rejected', $2, $3)`,
    [rows[0].invoice_id, managerId, reason || 'Edit request rejected.'],
  );

  await logActivity({
    entityType: 'invoice',
    entityId: rows[0].invoice_id,
    action: 'invoice.edit_rejected',
    performedBy: managerId,
    notes: reason || null,
  });

  if (io) {
    io.emit('edit_request_reviewed', {
      requestId,
      invoiceId: rows[0].invoice_id,
      status: 'rejected',
      reviewedBy: managerId,
      requestedBy: rows[0].requested_by,
      reason: reason || null,
      at: new Date().toISOString(),
    });
  }
}

module.exports = {
  generateInvoiceNumber,
  computeTotals,
  computeLineFigures,
  replaceItems,
  recalculateAndPersistTotals,
  findStockShortfalls,
  confirmInvoice,
  cancelInvoice,
  applyEditRequest,
  rejectEditRequest,
  shortenPcCode,
};
