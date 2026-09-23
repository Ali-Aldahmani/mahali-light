const { query, withTransaction } = require('../db/postgres');
const { todayStoreDate } = require('../utils/dates');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { applyStockMovement } = require('./stockService');
const { logActivity } = require('../utils/activityLog');
const cashService = require('./cashService');
const bankService = require('./bankService');
const journalService = require('./journalService');
const notificationService = require('./notificationService');

const RETURN_TYPES = new Set([
  'customer_refund',
  'customer_replace',
  'supplier_return',
]);
const CONDITIONS = new Set(['good', 'defective', 'damaged']);
const REFUND_METHODS = new Set(['cash', 'bank', 'credit']);
const REQUEST_NOTE_MIN = 10;

function money(n) {
  const v = Number(n) || 0;
  // A tiny epsilon avoids IEEE-754 float drift mis-rounding values that land
  // exactly on a half-cent boundary (e.g. 2.90*0.05 stores as
  // 0.14499999999999999, which would round down to 0.14 instead of 0.15).
  return v < 0 ? -Math.round(-v * 100 + 1e-9) / 100 : Math.round(v * 100 + 1e-9) / 100;
}

function stockActionFor(condition, override) {
  if (override && ['returned_to_stock', 'quarantined', 'disposed'].includes(override)) {
    return override;
  }
  if (condition === 'good') return 'returned_to_stock';
  return 'quarantined';
}

async function nextRequestNumber(client) {
  const { formatted } = await nextDocumentNumber(client, 'RET', undefined, {
    padWidth: 5,
  });
  return formatted;
}

async function nextOrderNumber(client) {
  const { formatted } = await nextDocumentNumber(client, 'RO', undefined, {
    padWidth: 5,
  });
  return formatted;
}

// Total qty of a single invoice item that has already been promised to other
// return requests in pending / approved state. Used to enforce
// BIZ_RETURN_QTY_EXCEEDED and BIZ_RETURN_ALREADY_EXISTS.
async function loadCommittedReturnTotals(client, invoiceItemId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(rri.quantity), 0)::numeric AS qty,
            COALESCE(SUM(rri.total_value), 0)::numeric AS value
       FROM return_request_items rri
       JOIN return_requests rr ON rr.id = rri.return_request_id
      WHERE rri.invoice_item_id = $1
        AND rr.status IN ('pending','approved')`,
    [invoiceItemId],
  );
  return { quantity: Number(rows[0].qty || 0), value: money(rows[0].value) };
}

// Pull the invoice + items for validation. Throws if the invoice is cancelled
// or missing.
async function loadInvoiceForReturn(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
    [invoiceId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Invoice not found.', {
      status: 404,
    });
  }
  const invoice = rows[0];
  if (invoice.status === 'cancelled') {
    throw new AppError(ERROR_CODES.BIZ_INVOICE_CANCELLED, undefined, {
      status: 409,
    });
  }
  if (invoice.status !== 'confirmed') {
    throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'Only confirmed invoices can be returned.');
  }
  const { rows: items } = await client.query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1
      ORDER BY position ASC, created_at ASC FOR UPDATE`,
    [invoiceId],
  );
  return { invoice, items };
}

function totalsFor(items) {
  let total = 0;
  for (const it of items) total += Number(it.totalValue ?? it.total_value ?? 0);
  return money(total);
}

// Allocate the actual paid invoice value (line discounts, invoice discount,
// and tax included) in cents. Cumulative rounding preserves the invoice total.
function refundableLineValues(invoice, items) {
  const net = items.reduce((sum, it) => sum + Number(it.line_total), 0);
  let cumulative = 0;
  let allocated = 0;
  return new Map(items.map((it) => {
    cumulative += Number(it.line_total);
    const through = net > 0 ? money(Number(invoice.total) * cumulative / net) : 0;
    const value = money(through - allocated);
    allocated = through;
    return [it.id, value];
  }));
}

// Validate the refund_plan adds up to the requested refund total. Returns the
// normalised plan rows ready for persistence + execution.
function validateRefundPlan(plan, expectedTotal, { required = false } = {}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    if (required && expectedTotal > 0) {
      throw new AppError(ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH,
        'A complete refund plan is required before approval.', { status: 409 });
    }
    return null;
  }
  let sum = 0;
  const rows = plan.map((p) => {
    if (!REFUND_METHODS.has(p.method)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Unknown refund method ${p.method}.`,
      );
    }
    const amount = money(p.amount);
    if (!Number.isFinite(Number(p.amount)) || amount <= 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Refund amounts must be greater than zero.',
      );
    }
    sum = money(sum + amount);
    return {
      method: p.method,
      amount,
      bankAccountId: p.bankAccountId || null,
      notes: p.notes || null,
    };
  });
  if (Math.round(sum * 100) !== Math.round(expectedTotal * 100)) {
    throw new AppError(ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH, undefined, {
      status: 409,
      details: { expectedTotal, planned: sum },
    });
  }
  return rows;
}

async function loadCatalogVariant(client, variantId) {
  const { rows } = await client.query(
    `SELECT v.id, v.product_id, v.sku, v.selling_price, v.cost_price,
            p.name AS product_name, p.unit_label
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1 AND v.is_active = true AND p.is_active = true`,
    [variantId],
  );
  if (!rows.length) {
    throw new AppError(
      ERROR_CODES.RESOURCE_NOT_FOUND,
      `Product variant ${variantId} not found.`,
      { status: 404 },
    );
  }
  return rows[0];
}

// Resolve replacement lines from catalog selling prices — never trust client unitPrice.
async function resolveReplacementPlan(client, plan) {
  if (!plan) return null;
  let parsed = plan;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_e) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Replacement plan is malformed.',
      );
    }
  }
  if (!Array.isArray(parsed.items) || !parsed.items.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Replacement plan items must be an array.',
    );
  }
  const items = [];
  for (const it of parsed.items) {
    if (
      !it.variantId ||
      !Number.isFinite(Number(it.quantity)) ||
      Number(it.quantity) <= 0 ||
      money(it.quantity) !== Number(it.quantity)
    ) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid replacement item.');
    }
    const v = await loadCatalogVariant(client, it.variantId);
    const qty = Math.max(0, Number(it.quantity) || 0);
    const unitPrice = money(v.selling_price);
    items.push({
      variantId: v.id,
      productId: v.product_id,
      productName: v.product_name,
      quantity: qty,
      unitPrice,
      lineTotal: money(unitPrice * qty),
    });
  }
  const replacementTotal = money(items.reduce((sum, it) => sum + it.lineTotal, 0));
  return {
    items,
    replacementTotal,
    // Derived at approve time from return total vs replacement total.
    priceDifference: 0,
    differenceDirection: 'none',
  };
}

// Look up an invoice / customer / serial number / phone / product name and
// return matching invoices with line items. Used by the new-return UI to
// pre-populate the form.
async function lookupTransaction({ q, mode = 'auto', limit = 10 }) {
  const term = (q || '').toString().trim();
  if (!term) return [];

  const like = `%${term}%`;
  const filters = [];
  const params = [];
  let i = 1;

  if (mode === 'invoice' || mode === 'auto') {
    filters.push(`i.invoice_number ILIKE $${i}`);
    params.push(like);
    i++;
  }
  if (mode === 'customer' || mode === 'auto') {
    filters.push(`c.name ILIKE $${i}`);
    params.push(like);
    i++;
  }
  if (mode === 'phone' || mode === 'auto') {
    filters.push(`c.phone ILIKE $${i}`);
    params.push(like);
    i++;
  }
  if (mode === 'serial' || mode === 'auto') {
    filters.push(
      `EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.serial_number ILIKE $${i})`,
    );
    params.push(like);
    i++;
  }
  if (mode === 'product' || mode === 'auto') {
    filters.push(
      `EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.product_name ILIKE $${i})`,
    );
    params.push(like);
    i++;
  }

  if (!filters.length) return [];

  params.push(limit);

  const { rows } = await query(
    `SELECT i.id, i.invoice_number, i.created_at, i.confirmed_at, i.total,
            i.status, i.payment_status, i.has_return, i.customer_id,
            c.name AS customer_name, c.phone AS customer_phone,
            u.username AS cashier_username
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.status <> 'cancelled' AND (${filters.join(' OR ')})
      ORDER BY i.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  if (!rows.length) return [];

  const invoiceIds = rows.map((r) => r.id);
  const { rows: items } = await query(
    `SELECT ii.*, COALESCE(SUM(rri.quantity), 0)::numeric AS committed_qty,
            COALESCE(SUM(rri.total_value), 0)::numeric AS committed_value
       FROM invoice_items ii
       LEFT JOIN return_request_items rri
         ON rri.invoice_item_id = ii.id
        AND rri.return_request_id IN (
          SELECT rr.id FROM return_requests rr
           WHERE rr.status IN ('pending','approved')
        )
      WHERE ii.invoice_id = ANY($1)
      GROUP BY ii.id
      ORDER BY ii.position ASC, ii.created_at ASC`,
    [invoiceIds],
  );

  const itemsByInvoice = new Map();
  const valuesByInvoice = new Map(rows.map((inv) => [inv.id,
    refundableLineValues(inv, items.filter((it) => it.invoice_id === inv.id)),
  ]));
  for (const it of items) {
    if (!itemsByInvoice.has(it.invoice_id)) itemsByInvoice.set(it.invoice_id, []);
    itemsByInvoice.get(it.invoice_id).push({
      id: it.id,
      productId: it.product_id,
      variantId: it.variant_id,
      productName: it.product_name,
      sku: it.sku,
      unitLabel: it.unit_label,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      refundableLineValue: valuesByInvoice.get(it.invoice_id).get(it.id),
      lineTotal: Number(it.line_total),
      serialNumber: it.serial_number || null,
      committedReturnQty: Number(it.committed_qty || 0),
      committedReturnValue: Number(it.committed_value || 0),
      availableQty: Math.max(0, Number(it.quantity) - Number(it.committed_qty || 0)),
    });
  }

  return rows.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    createdAt: inv.confirmed_at || inv.created_at,
    total: Number(inv.total),
    status: inv.status,
    paymentStatus: inv.payment_status,
    hasReturn: inv.has_return,
    customerId: inv.customer_id,
    customerName: inv.customer_name,
    customerPhone: inv.customer_phone,
    cashierUsername: inv.cashier_username,
    items: itemsByInvoice.get(inv.id) || [],
  }));
}

// Snapshot the resolved item list for a request — validate quantity against
// already-committed returns + the originating invoice line.
async function buildRequestItems(
  client,
  { items, referenceType, invoice, invoiceItems },
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Return must include at least one item.',
    );
  }

  const itemsById = new Map();
  for (const it of invoiceItems || []) itemsById.set(it.id, it);
  const values = invoice ? refundableLineValues(invoice, invoiceItems) : new Map();
  const seenItems = new Set();

  const resolved = [];
  for (const raw of items) {
    if (!raw.condition || !CONDITIONS.has(raw.condition)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid condition for return item: ${raw.condition}.`,
      );
    }
    const qty = Number(raw.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || money(qty) !== qty) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Return quantity must be greater than zero.',
      );
    }
    let item = {
      invoiceItemId: raw.invoiceItemId || null,
      productId: raw.productId || null,
      variantId: raw.variantId || null,
      productName: raw.productName || null,
      unitLabel: raw.unitLabel || 'pcs',
      unitPrice: 0,
      condition: raw.condition,
      serialNumber: raw.serialNumber || null,
      warrantyId: raw.warrantyId || null,
      quantity: qty,
    };

    if (referenceType === 'invoice') {
      if (!raw.invoiceItemId || seenItems.has(raw.invoiceItemId)) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Each return must identify a unique invoice line.');
      }
      seenItems.add(raw.invoiceItemId);
      const inv = itemsById.get(raw.invoiceItemId);
      if (!inv) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `Invoice item ${raw.invoiceItemId} does not belong to invoice ${invoice?.invoice_number || ''}.`,
        );
      }
      if (inv.is_custom) {
        // Custom/third-party lines have no variant to restock and no
        // tracked supplier to reverse a payable against — the stock and
        // COGS-reversal machinery below assumes a real catalog item.
        // Handling this line's return needs a manual arrangement with the
        // third party rather than the normal return flow.
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `"${inv.product_name}" is a custom/third-party item and can't be processed through a stock return — settle it directly with ${inv.third_party_name || 'the third party'}.`,
        );
      }
      item.productId = inv.product_id;
      item.variantId = inv.variant_id;
      item.productName = inv.product_name;
      item.unitLabel = inv.unit_label;
      item.unitPrice = Number(inv.unit_price);
      if (!item.serialNumber) item.serialNumber = inv.serial_number || null;

      const { quantity: committed, value: committedValue } = await loadCommittedReturnTotals(client, raw.invoiceItemId);
      const maxQty = Number(inv.quantity) - committed;
      if (qty > maxQty + 0.0001) {
        throw new AppError(
          ERROR_CODES.BIZ_RETURN_QTY_EXCEEDED,
          `Return ${qty} exceeds the ${maxQty} remaining on invoice item ${inv.product_name}.`,
          {
            status: 409,
            details: { availableQty: maxQty, requestedQty: qty },
          },
        );
      }
      const lineValue = values.get(inv.id);
      const remainingValue = money(lineValue - committedValue);
      if (remainingValue < 0) {
        throw new AppError(ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH, 'Existing returns exceed the discounted line value.');
      }
      item.totalValue = qty === maxQty ? remainingValue : Math.max(0, Math.min(
        remainingValue,
        Math.ceil(lineValue * 100 * qty / Number(inv.quantity) - 1e-8) / 100,
        money(money(lineValue * (committed + qty) / Number(inv.quantity)) - committedValue),
      ));
      item.unitPrice = money(lineValue / Number(inv.quantity));
    } else {
      if (!raw.variantId) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Manual returns must select a catalog product.',
        );
      }
      const v = await loadCatalogVariant(client, raw.variantId);
      item.productId = v.product_id;
      item.variantId = v.id;
      item.productName = v.product_name;
      item.unitLabel = v.unit_label || 'pcs';
      item.unitPrice = money(v.selling_price);
      item.totalValue = money(item.unitPrice * qty);
    }

    if (!item.productId || !item.productName) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Return items must include a product reference.',
      );
    }

    item.totalValue ??= money(item.unitPrice * qty);
    resolved.push(item);
  }
  return resolved;
}

// =======================================================================
// Create
// =======================================================================
async function createReturnRequest({
  returnType,
  referenceType = 'invoice',
  referenceId = null,
  customerId = null,
  supplierId = null,
  noInvoiceReturn = false,
  approvedBy = null,
  reason,
  requestNote,
  items,
  refundPlan = null,
  replacementPlan = null,
  requestedBy,
  io = null,
}) {
  if (!RETURN_TYPES.has(returnType)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Invalid return type ${returnType}.`,
    );
  }
  if (!requestNote || String(requestNote).trim().length < REQUEST_NOTE_MIN) {
    throw new AppError(ERROR_CODES.BIZ_RETURN_NOTE_TOO_SHORT, undefined, {
      status: 400,
    });
  }
  if (!reason) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Reason is required.');
  }
  if (noInvoiceReturn && !approvedBy) {
    // The "approved_by" field on a no-invoice request must reference the
    // manager who authorised the over-the-counter return at the desk. The
    // controller resolves this — service double-checks.
    throw new AppError(ERROR_CODES.BIZ_NO_INVOICE_NEEDS_APPROVAL, undefined, {
      status: 409,
    });
  }
  if (returnType !== 'supplier_return' && referenceType !== 'invoice' && !noInvoiceReturn) {
    throw new AppError(ERROR_CODES.BIZ_NO_INVOICE_NEEDS_APPROVAL);
  }

  return withTransaction(async (client) => {
    let invoice = null;
    let invoiceItems = [];
    if (referenceType === 'invoice' && referenceId) {
      const loaded = await loadInvoiceForReturn(client, referenceId);
      invoice = loaded.invoice;
      invoiceItems = loaded.items;
      customerId = invoice.customer_id;
    }

    const resolvedItems = await buildRequestItems(client, {
      items,
      referenceType,
      invoice,
      invoiceItems,
    });

    const totalValue = totalsFor(resolvedItems);
    const validatedReplacementPlan =
      returnType === 'customer_replace'
        ? await resolveReplacementPlan(client, replacementPlan)
        : null;
    const replacementTotal = validatedReplacementPlan
      ? money(validatedReplacementPlan.items.reduce((sum, it) => sum + it.lineTotal, 0)) : 0;
    const validatedRefundPlan = returnType === 'supplier_return' ? null : validateRefundPlan(
      refundPlan, returnType === 'customer_replace' ? Math.max(0, money(totalValue - replacementTotal)) : totalValue,
    );

    const requestNumber = await nextRequestNumber(client);

    const { rows: ins } = await client.query(
      `INSERT INTO return_requests (
        request_number, return_type, reference_type, reference_id,
        customer_id, supplier_id, no_invoice_return, approved_by,
        reason, request_note, requested_by, status, refund_plan, replacement_plan
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)
      RETURNING *`,
      [
        requestNumber,
        returnType,
        referenceType,
        referenceId,
        customerId,
        supplierId,
        !!noInvoiceReturn,
        approvedBy,
        reason,
        requestNote.trim(),
        requestedBy,
        validatedRefundPlan ? JSON.stringify(validatedRefundPlan) : null,
        validatedReplacementPlan
          ? JSON.stringify(validatedReplacementPlan)
          : null,
      ],
    );
    const request = ins[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO return_request_items (
          return_request_id, product_id, variant_id, invoice_item_id,
          product_name, quantity, unit_label, unit_price, total_value,
          condition, serial_number, warranty_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          request.id,
          item.productId,
          item.variantId,
          item.invoiceItemId,
          item.productName,
          item.quantity,
          item.unitLabel,
          item.unitPrice,
          item.totalValue,
          item.condition,
          item.serialNumber,
          item.warrantyId,
        ],
      );
    }

    await client.query(
      `INSERT INTO return_request_history
         (return_request_id, action, performed_by, new_status, notes)
       VALUES ($1,'created',$2,'pending',$3)`,
      [request.id, requestedBy, requestNote.trim()],
    );

    await logActivity({
      entityType: 'return_request',
      entityId: request.id,
      action: 'return_request.created',
      performedBy: requestedBy,
      newValue: { returnType, totalValue, itemCount: resolvedItems.length },
      notes: requestNote.trim(),
    });

    if (io) {
      const payload = {
        requestId: request.id,
        requestNumber: request.request_number,
        returnType,
        requestedBy,
        isNoInvoice: !!noInvoiceReturn,
        at: new Date().toISOString(),
      };
      io.to('role:Manager').emit('return_request_created', payload);
      io.to('role:Admin').emit('return_request_created', payload);
    }

    try {
      await notificationService.notifyManagersAndAdmins({
        type: 'approval.return_pending',
        category: 'approval',
        severity: noInvoiceReturn ? 'warning' : 'info',
        title: `Return request ${request.request_number}${noInvoiceReturn ? ' (no invoice)' : ''}`,
        message: `Pending approval. Total value AED ${Number(totalValue || 0).toFixed(2)}.`,
        referenceType: 'return_request',
        referenceId: request.id,
        actionUrl: `/returns/requests/${request.id}`,
        createdBy: requestedBy,
        skipForUserId: requestedBy,
      });
      if (noInvoiceReturn) {
        await notificationService.notifyManagersAndAdmins({
          type: 'return.no_invoice_flagged',
          category: 'return',
          severity: 'critical',
          title: `No-invoice return flagged: ${request.request_number}`,
          message: `Manual scrutiny required — return submitted without an original invoice.`,
          referenceType: 'return_request',
          referenceId: request.id,
          actionUrl: `/returns/requests/${request.id}`,
          createdBy: requestedBy,
        });
      }
    } catch (_e) { /* best-effort */ }

    return { request, totalValue, itemCount: resolvedItems.length };
  });
}

// =======================================================================
// Approve + execute
// =======================================================================
async function approveAndExecute({ requestId, managerId, notes = null, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM return_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Return request not found.', {
        status: 404,
      });
    }
    const request = rows[0];
    if (request.status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_RETURN_NOT_PENDING, undefined, {
        status: 409,
      });
    }
    const { rows: items } = await client.query(
      `SELECT * FROM return_request_items WHERE return_request_id = $1`,
      [requestId],
    );

    const executionEvents = [];
    let supplierReturnCost = 0;

    // Reload invoice (if any) to grab the customer + status fresh.
    let invoice = null;
    let originalItems = [];
    if (request.reference_type === 'invoice' && request.reference_id) {
      const loaded = await loadInvoiceForReturn(client, request.reference_id);
      invoice = loaded.invoice;
      originalItems = loaded.items;
      const values = refundableLineValues(invoice, originalItems);
      const seen = new Set();
      for (const it of items) {
        const original = originalItems.find((line) => line.id === it.invoice_item_id);
        if (!original || seen.has(original.id)) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid or duplicate invoice return line.');
        }
        seen.add(original.id);
        const committed = await loadCommittedReturnTotals(client, original.id);
        if (committed.quantity > Number(original.quantity)) {
          throw new AppError(ERROR_CODES.BIZ_RETURN_QTY_EXCEEDED);
        }
        const { rows: used } = await client.query(
          `SELECT COALESCE(SUM(rri.total_value), 0)::numeric AS value,
                  COALESCE(SUM(rri.quantity), 0)::numeric AS qty
             FROM return_request_items rri JOIN return_requests rr ON rr.id = rri.return_request_id
            WHERE rri.invoice_item_id = $1 AND rr.status = 'approved'`, [original.id],
        );
        const remainingValue = money(values.get(original.id) - Number(used[0].value));
        const isFinal = money(Number(used[0].qty) + Number(it.quantity)) === Number(original.quantity);
        const maxValue = isFinal ? remainingValue : Math.min(remainingValue,
          Math.ceil(values.get(original.id) * 100 * Number(it.quantity) / Number(original.quantity) - 1e-8) / 100);
        // Legacy requests may contain undiscounted prices: never execute them.
        if (Number(it.total_value) > maxValue + 0.001) {
          throw new AppError(ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH,
            'Return value exceeds the discounted invoice value; recreate this request.');
        }
      }
    }
    if (!items.length || items.some((it) => !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0 ||
        !Number.isFinite(Number(it.total_value)) || Number(it.total_value) < 0)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Return has missing or invalid items.');
    }

    const totalValue = money(
      items.reduce((acc, it) => acc + Number(it.total_value || 0), 0),
    );
    const replacementPlan = request.return_type === 'customer_replace'
      ? await resolveReplacementPlan(client, request.replacement_plan) : null;
    if (request.return_type === 'customer_replace' && !replacementPlan) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Replacement items are required.');
    }
    const replacementTotal = replacementPlan
      ? money(replacementPlan.items.reduce((sum, it) => sum + it.lineTotal, 0)) : 0;
    const expectedRefund = request.return_type === 'customer_replace'
      ? Math.max(0, money(totalValue - replacementTotal)) : totalValue;
    const refundPlan = request.return_type === 'supplier_return' ? null
      : validateRefundPlan(request.refund_plan, expectedRefund, { required: true });

    // --- Build the return_order shell ----------------------------------
    const orderNumber = await nextOrderNumber(client);
    const { rows: orderRows } = await client.query(
      `INSERT INTO return_orders (
         return_order_number, return_request_id, return_type, customer_id,
         supplier_id, original_invoice_id, original_po_id, employee_id, total_value,
         refund_total, status, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'completed',$10)
       RETURNING *`,
      [
        orderNumber,
        request.id,
        request.return_type,
        request.customer_id,
        request.supplier_id,
        request.reference_type === 'invoice' ? request.reference_id : null,
        request.reference_type === 'purchase_order' ? request.reference_id : null,
        managerId,
        totalValue,
        notes || null,
      ],
    );
    const order = orderRows[0];
    const orderId = order.id;

    // --- Move stock + record return_order_items ------------------------
    for (const it of items) {
      const stockAction = stockActionFor(it.condition);
      if (it.variant_id) {
        if (request.return_type === 'supplier_return') {
          const { variant } = await applyStockMovement({
            client,
            variantId: it.variant_id,
            productId: it.product_id,
            type: 'return_out',
            quantity: Number(it.quantity),
            referenceType: 'return_order',
            referenceId: orderId,
            employeeId: managerId,
            notes: `Supplier return ${orderNumber}`,
            io: null,
          });
          // Journal/inventory valuation must use COST, not the request's
          // stored total_value/unit_price (those are priced at selling_price
          // for non-invoice-referenced returns — see buildRequestItems —
          // which is the wrong basis for what the supplier actually owes us).
          const { rows: costRows } = await client.query(
            `SELECT cost_price FROM product_variants WHERE id = $1`,
            [it.variant_id],
          );
          supplierReturnCost += Number(it.quantity) * Number(costRows[0]?.cost_price || 0);
          executionEvents.push({
            event: 'stock_updated',
            payload: {
              productId: variant.productId,
              variantId: variant.id,
              newQty: variant.stockQty,
              quarantineQty: variant.quarantineQty,
              movementType: 'return_out',
              delta: variant.delta,
              changedBy: managerId,
              timestamp: new Date().toISOString(),
              referenceType: 'return_order',
              referenceId: orderId,
            },
          });
        } else if (stockAction === 'returned_to_stock') {
          const { variant } = await applyStockMovement({
            client,
            variantId: it.variant_id,
            productId: it.product_id,
            type: 'return_in',
            quantity: Number(it.quantity),
            referenceType: 'return_order',
            referenceId: orderId,
            employeeId: managerId,
            notes: `Return ${orderNumber}`,
            io: null,
          });
          executionEvents.push({
            event: 'stock_updated',
            payload: {
              productId: variant.productId,
              variantId: variant.id,
              newQty: variant.stockQty,
              quarantineQty: variant.quarantineQty,
              movementType: 'return_in',
              delta: variant.delta,
              changedBy: managerId,
              timestamp: new Date().toISOString(),
              referenceType: 'return_order',
              referenceId: orderId,
            },
          });
        } else if (stockAction === 'quarantined') {
          const { variant } = await applyStockMovement({
            client,
            variantId: it.variant_id,
            productId: it.product_id,
            type: 'return_in',
            quantity: Number(it.quantity),
            referenceType: 'return_order',
            referenceId: orderId,
            employeeId: managerId,
            notes: `Return ${orderNumber} (defective)`,
            io: null,
          });
          // Then immediately quarantine the same units.
          const { variant: variantQ } = await applyStockMovement({
            client,
            variantId: it.variant_id,
            productId: it.product_id,
            type: 'quarantine',
            quantity: Number(it.quantity),
            referenceType: 'return_order',
            referenceId: orderId,
            employeeId: managerId,
            notes: `Return ${orderNumber} quarantined`,
            io: null,
          });
          executionEvents.push({
            event: 'stock_updated',
            payload: {
              productId: variantQ.productId,
              variantId: variantQ.id,
              newQty: variantQ.stockQty,
              quarantineQty: variantQ.quarantineQty,
              movementType: 'return_in',
              delta: variant.delta,
              changedBy: managerId,
              timestamp: new Date().toISOString(),
              referenceType: 'return_order',
              referenceId: orderId,
            },
          });
        }
        // 'disposed' deliberately makes no stock movement — manager has
        // chosen to write the units off entirely.
      }

      await client.query(
        `INSERT INTO return_order_items (
          return_order_id, product_id, variant_id, product_name, quantity,
          unit_label, unit_price, total_value, condition, stock_action,
          serial_number, warranty_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          orderId,
          it.product_id,
          it.variant_id,
          it.product_name,
          it.quantity,
          it.unit_label,
          it.unit_price,
          it.total_value,
          it.condition,
          stockAction,
          it.serial_number,
          it.warranty_id,
        ],
      );

      // Void the warranty tied to this invoice item (if any) — the customer
      // has handed the product back and cannot claim against it any longer.
      if (it.invoice_item_id) {
        await client.query(
          `UPDATE warranties
              SET status = 'void',
                  voided_at = NOW(),
                  voided_by = $1,
                  void_reason = COALESCE(void_reason, 'Returned via ' || $2),
                  updated_at = NOW()
            WHERE invoice_item_id = $3
              AND status = 'active'`,
          [managerId, orderNumber, it.invoice_item_id],
        );
      }
    }

    if (invoice && request.return_type !== 'supplier_return') {
      const returnedCost = money(items.reduce((sum, it) => {
        if (stockActionFor(it.condition) === 'disposed') return sum;
        const original = originalItems.find((line) => line.id === it.invoice_item_id);
        return sum + Number(it.quantity) * Number(original.cost_price_at_time);
      }, 0));
      await journalService.postReturnedInventoryEntry(client, {
        returnOrderId: orderId, returnOrderNumber: orderNumber, amount: returnedCost,
        date: todayStoreDate(), userId: managerId,
      });
    }

    if (request.return_type === 'supplier_return') {
      // Reverse input VAT at the originating PO's own rate. Without a PO
      // reference we don't know what VAT (if any) was claimed on these goods,
      // so none is reversed.
      let supplierReturnVat = 0;
      if (request.reference_type === 'purchase_order' && request.reference_id) {
        const { rows: [po] } = await client.query(
          `SELECT subtotal, tax_amount FROM purchase_orders WHERE id = $1`,
          [request.reference_id],
        );
        if (po && Number(po.subtotal) > 0) {
          supplierReturnVat = money(
            supplierReturnCost * (Number(po.tax_amount) || 0) / Number(po.subtotal),
          );
        }
      }
      await journalService.postSupplierReturnEntry(client, {
        returnOrderId: orderId, returnOrderNumber: orderNumber, amount: money(supplierReturnCost),
        vatAmount: supplierReturnVat, date: todayStoreDate(), userId: managerId,
      });
    }

    // --- Refund payments (customer flows only) -------------------------
    let refundTotal = 0;

    if (
      request.return_type === 'customer_refund' ||
      (request.return_type === 'customer_replace' && refundPlan)
    ) {
      if (Array.isArray(refundPlan) && refundPlan.length > 0) {
        for (const p of refundPlan) {
          const amount = money(p.amount);
          refundTotal = money(refundTotal + amount);
          await client.query(
            `INSERT INTO refund_payments
               (return_order_id, method, amount, bank_account_id, employee_id, notes)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              orderId,
              p.method,
              amount,
              p.bankAccountId || null,
              managerId,
              p.notes || null,
            ],
          );

          if (p.method === 'credit') {
            if (!request.customer_id) throw new AppError(ERROR_CODES.BIZ_GUEST_NO_CREDIT);
            const { rows: customers } = await client.query(
              `SELECT credit_balance FROM customers WHERE id = $1 FOR UPDATE`, [request.customer_id],
            );
            if (!customers.length || Number(customers[0].credit_balance) < amount) {
              throw new AppError(ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE,
                'Credit refund exceeds the customer outstanding balance.');
            }
            // Receivable is reduced, matching the journal credit to 1003.
            await client.query(
              `UPDATE customers
                  SET credit_balance = credit_balance - $1,
                      updated_at = NOW()
                WHERE id = $2`,
              [amount, request.customer_id],
            );
          }

          // Post the journal entry for this refund line — reverses Sales
          // Revenue + VAT Payable (proportional to the original invoice's
          // tax rate), CR cash / bank / receivable depending on method.
          await journalService.postRefundEntry(client, {
            returnOrderId: orderId,
            returnOrderNumber: orderNumber,
            amount,
            method: p.method,
            date: todayStoreDate(),
            userId: managerId,
            taxRate: invoice ? Number(invoice.tax_rate) || 0 : 0,
          });

          // Cash / bank refunds now book through the treasury services.
          if (p.method === 'cash') {
            const posted = await cashService.recordCashOut({
              client,
              transactionType: 'refund',
              amount,
              referenceType: 'return_order',
              referenceId: orderId,
              employeeId: managerId,
              notes: `Refund for ${orderNumber}`,
            });
            executionEvents.push({
              event: 'cash_balance_updated',
              payload: {
                newBalance: posted.balanceAfter,
                delta: posted.delta,
                transactionType: 'refund',
                changedBy: managerId,
                at: new Date().toISOString(),
              },
              audience: ['role:Manager', 'role:Admin'],
            });
          } else if (p.method === 'bank') {
            const posted = await bankService.recordBankOut({
              client,
              bankAccountId: p.bankAccountId || null,
              transactionType: 'refund',
              amount,
              referenceType: 'return_order',
              referenceId: orderId,
              employeeId: managerId,
              description: `Refund for ${orderNumber}`,
              allowOverdraft: true,
            });
            executionEvents.push({
              event: 'bank_balance_updated',
              payload: {
                bankAccountId: posted.accountId,
                bankName: posted.bankName,
                newBalance: posted.balanceAfter,
                delta: posted.delta,
                transactionType: 'refund',
                changedBy: managerId,
                at: new Date().toISOString(),
              },
              audience: ['role:Manager', 'role:Admin'],
            });
          }
        }
      }
    }

    // --- Replacement invoice (customer_replace) ------------------------
    let replacementInvoiceId = null;

    if (
      request.return_type === 'customer_replace' &&
      replacementPlan &&
      Array.isArray(replacementPlan.items) &&
      replacementPlan.items.length > 0
    ) {
      const built = await buildReplacementInvoice(client, {
        customerId: request.customer_id,
        managerId,
        items: replacementPlan.items,
        priceDifference: Math.max(0, money(replacementTotal - totalValue)),
        differenceDirection: replacementTotal > totalValue ? 'customer_pays' : 'none',
        returnOrderNumber: orderNumber,
      });
      replacementInvoiceId = built.invoiceId;
      executionEvents.push(...built.stockEmits);
    }

    // --- Update return_order with the totals + links -------------------
    await client.query(
      `UPDATE return_orders
          SET refund_total = $1,
              replacement_invoice_id = $2,
              status = 'completed'
        WHERE id = $3`,
      [refundTotal, replacementInvoiceId, orderId],
    );

    // --- Mark request as approved + executed ---------------------------
    await client.query(
      `UPDATE return_requests
          SET status = 'approved',
              reviewed_by = $1,
              reviewed_at = NOW(),
              executed_by = $1,
              executed_at = NOW(),
              notes = COALESCE(NULLIF($2,''), notes)
        WHERE id = $3`,
      [managerId, notes || null, request.id],
    );

    await client.query(
      `INSERT INTO return_request_history
         (return_request_id, action, performed_by, old_status, new_status, notes)
       VALUES ($1,'approved',$2,'pending','approved',$3),
              ($1,'executed',$2,'approved','approved',$4)`,
      [
        request.id,
        managerId,
        notes || null,
        `Return order ${orderNumber}`,
      ],
    );

    // Flag the original invoice as having a return so the invoice list +
    // detail page show the indicator.
    if (invoice) {
      await client.query(
        `UPDATE invoices SET has_return = true, updated_at = NOW() WHERE id = $1`,
        [invoice.id],
      );
    }

    await logActivity({
      entityType: 'return_request',
      entityId: request.id,
      action: 'return_request.approved',
      performedBy: managerId,
      notes,
    });
    await logActivity({
      entityType: 'return_order',
      entityId: orderId,
      action: 'return_order.executed',
      performedBy: managerId,
      newValue: {
        returnType: request.return_type,
        totalValue,
        refundTotal,
        replacementInvoiceId,
      },
    });

    return {
      request: { ...request, status: 'approved' },
      order: { ...order, refund_total: refundTotal, replacement_invoice_id: replacementInvoiceId },
      executionEvents,
    };
  }).then((result) => {
    if (io) {
      io.to(`user:${result.request.requested_by}`).emit(
        'return_request_reviewed',
        {
          requestId: result.request.id,
          status: 'approved',
          reviewedBy: result.request.reviewed_by,
          at: new Date().toISOString(),
        },
      );
      if (result.request.requested_by) {
        notificationService
          .notifyUser(result.request.requested_by, {
            type: 'return.request_approved',
            category: 'return',
            severity: 'info',
            title: `Return approved`,
            message: `Your return request was approved and executed.`,
            referenceType: 'return_request',
            referenceId: result.request.id,
            actionUrl: `/returns/requests/${result.request.id}`,
          })
          .catch(() => {});
      }
      io.emit('return_executed', {
        returnOrderId: result.order.id,
        returnOrderNumber: result.order.return_order_number,
        returnType: result.order.return_type,
        stockUpdated: result.executionEvents.length > 0,
        at: new Date().toISOString(),
      });
      for (const ev of result.executionEvents) {
        if (!ev) continue;
        if (ev.audience && ev.audience.length) {
          for (const room of ev.audience) io.to(room).emit(ev.event, ev.payload);
        } else {
          io.emit(ev.event, ev.payload);
        }
      }
    }
    return result;
  });
}

async function buildReplacementInvoice(
  client,
  { customerId, managerId, items, priceDifference, differenceDirection, returnOrderNumber },
) {
  const year = new Date().getFullYear();
  const scope = 'RET';
  const { formatted: invoiceNumber } = await nextDocumentNumber(
    client,
    'INV',
    year,
    { scope, padWidth: 5 },
  );

  // Decide the financial shape of the replacement invoice based on price
  // direction:
  //   • differenceDirection = 'none'              → zero-value invoice
  //   • differenceDirection = 'customer_pays'     → invoice charges difference
  //   • differenceDirection = 'refund_to_customer'→ zero-value invoice; the
  //     refund_plan handles the excess refund separately
  let subtotal = 0;
  for (const it of items) subtotal += money(Number(it.unitPrice) * Number(it.quantity));
  subtotal = money(subtotal);

  const total =
    differenceDirection === 'customer_pays' ? money(priceDifference) : 0;

  const { rows: inv } = await client.query(
    `INSERT INTO invoices (
      invoice_number, customer_id, status, payment_status,
      subtotal, discount_amount, tax_rate, taxable_amount, tax_amount,
      total, amount_paid, balance_due,
      pc_identifier, notes, created_by, confirmed_by, confirmed_at,
      invoice_discount
    ) VALUES (
      $1,$2,'confirmed','paid',
      $3,$3::numeric-$4::numeric,0,$4,0,
      $4,$4,0,
      $5,$6,$7,$7,NOW(),
      $3::numeric-$4::numeric
    ) RETURNING id`,
    [
      invoiceNumber,
      customerId || null,
      subtotal,
      total,
      'RET',
      `Replacement invoice for return ${returnOrderNumber}`,
      managerId,
    ],
  );
  const invoiceId = inv[0].id;

  const stockEmits = [];
  let cogsAmount = 0;
  for (const it of items) {
    if (!it.variantId) continue;
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;

    const { rows: vRows } = await client.query(
      `SELECT v.id, v.product_id, v.sku, v.selling_price, v.cost_price,
              p.name AS product_name, p.unit_label
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1`,
      [it.variantId],
    );
    if (!vRows.length) {
      throw new AppError(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Replacement variant ${it.variantId} not found.`,
        { status: 404 },
      );
    }
    const v = vRows[0];
    cogsAmount += Number(v.cost_price || 0) * qty;
    const unitPrice = money(v.selling_price);

    await client.query(
      `INSERT INTO invoice_items (
        invoice_id, product_id, variant_id, product_name, variant_attributes,
        sku, unit_label, quantity, unit_price, cost_price_at_time,
        discount_percent, discount_amount, line_subtotal, line_total, position,
        serial_number
      ) VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7,$8,$9,0,0,$10,$11,0,NULL)`,
      [
        invoiceId,
        v.product_id,
        v.id,
        v.product_name,
        v.sku,
        v.unit_label || 'pcs',
        qty,
        unitPrice,
        Number(v.cost_price || 0),
        money(unitPrice * qty),
        money(unitPrice * qty),
      ],
    );

    const { variant } = await applyStockMovement({
      client,
      variantId: it.variantId,
      productId: v.product_id,
      type: 'sale',
      quantity: qty,
      referenceType: 'invoice',
      referenceId: invoiceId,
      employeeId: managerId,
      notes: `Replacement under ${returnOrderNumber}`,
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
        changedBy: managerId,
        timestamp: new Date().toISOString(),
        referenceType: 'invoice',
        referenceId: invoiceId,
      },
    });
  }

  // If the customer pays the difference, we record it as paid in cash by
  // default — managers can revise in Phase 10's banking flow.
  if (total > 0) {
    await client.query(
      `INSERT INTO invoice_payments (invoice_id, method, amount, employee_id, notes)
       VALUES ($1,'cash',$2,$3,$4)`,
      [
        invoiceId,
        total,
        managerId,
        `Price-difference payment for ${returnOrderNumber}`,
      ],
    );
    const posted = await cashService.recordCashIn({
      client, transactionType: 'sale', amount: total,
      referenceType: 'invoice', referenceId: invoiceId, employeeId: managerId,
      notes: `Price-difference payment for ${returnOrderNumber}`,
    });
    stockEmits.push({
      event: 'cash_balance_updated', audience: ['role:Manager', 'role:Admin'],
      payload: { newBalance: posted.balanceAfter, delta: posted.delta,
        transactionType: 'sale', changedBy: managerId, at: new Date().toISOString() },
    });
  }

  await journalService.postSaleEntry(client, {
    invoiceId, invoiceNumber, date: todayStoreDate(),
    subtotal: total, taxAmount: 0,
    payments: total > 0 ? [{ method: 'cash', amount: total }] : [],
    cogsAmount, userId: managerId,
  });

  await client.query(
    `INSERT INTO invoice_history (invoice_id, action, performed_by, notes)
     VALUES ($1, 'created', $2, $3), ($1, 'confirmed', $2, NULL)`,
    [invoiceId, managerId, `Replacement for ${returnOrderNumber}`],
  );

  return { invoiceId, stockEmits };
}

// =======================================================================
// Reject
// =======================================================================
async function rejectReturnRequest({
  requestId,
  managerId,
  rejectionReason,
  io = null,
}) {
  if (!rejectionReason || !rejectionReason.trim()) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A rejection reason is required.',
    );
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, requested_by, request_number FROM return_requests
        WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    if (rows[0].status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_RETURN_NOT_PENDING, undefined, {
        status: 409,
      });
    }
    await client.query(
      `UPDATE return_requests
          SET status = 'rejected',
              reviewed_by = $1,
              reviewed_at = NOW(),
              rejection_reason = $2
        WHERE id = $3`,
      [managerId, rejectionReason.trim(), requestId],
    );
    await client.query(
      `INSERT INTO return_request_history
         (return_request_id, action, performed_by, old_status, new_status, notes)
       VALUES ($1,'rejected',$2,'pending','rejected',$3)`,
      [requestId, managerId, rejectionReason.trim()],
    );
    await logActivity({
      entityType: 'return_request',
      entityId: requestId,
      action: 'return_request.rejected',
      performedBy: managerId,
      notes: rejectionReason.trim(),
    });
    return rows[0];
  }).then((row) => {
    if (io) {
      io.to(`user:${row.requested_by}`).emit('return_request_reviewed', {
        requestId,
        status: 'rejected',
        reviewedBy: managerId,
        rejectionReason: rejectionReason.trim(),
        at: new Date().toISOString(),
      });
    }
    if (row.requested_by) {
      notificationService
        .notifyUser(row.requested_by, {
          type: 'return.request_rejected',
          category: 'return',
          severity: 'warning',
          title: 'Return rejected',
          message: rejectionReason.trim()
            ? `Reason: ${rejectionReason.trim()}`
            : 'Your return request was rejected.',
          referenceType: 'return_request',
          referenceId: requestId,
          actionUrl: `/returns/requests/${requestId}`,
        })
        .catch(() => {});
    }
    return row;
  });
}

// =======================================================================
// Cancel (by original requester)
// =======================================================================
async function cancelReturnRequest({ requestId, userId, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, requested_by, request_number FROM return_requests
        WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const r = rows[0];
    if (r.status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_RETURN_NOT_PENDING, undefined, {
        status: 409,
      });
    }
    if (r.requested_by !== userId) {
      throw new AppError(
        ERROR_CODES.AUTH_NO_PERMISSION,
        'Only the requester can cancel this return.',
        { status: 403 },
      );
    }
    await client.query(
      `UPDATE return_requests
          SET status = 'cancelled',
              reviewed_at = NOW()
        WHERE id = $1`,
      [requestId],
    );
    await client.query(
      `INSERT INTO return_request_history
         (return_request_id, action, performed_by, old_status, new_status)
       VALUES ($1,'cancelled',$2,'pending','cancelled')`,
      [requestId, userId],
    );
    await logActivity({
      entityType: 'return_request',
      entityId: requestId,
      action: 'return_request.cancelled',
      performedBy: userId,
    });
    return r;
  }).then((row) => {
    if (io) {
      io.to('role:Manager').emit('return_request_reviewed', {
        requestId,
        status: 'cancelled',
        at: new Date().toISOString(),
      });
    }
    return row;
  });
}

module.exports = {
  refundableLineValues,
  validateRefundPlan,
  createReturnRequest,
  approveAndExecute,
  rejectReturnRequest,
  cancelReturnRequest,
  lookupTransaction,
};
