const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { applyStockMovement } = require('./stockService');
const { logActivity } = require('../utils/activityLog');
const notificationService = require('./notificationService');

// Compute end date by adding `months` whole calendar months and clamping to
// the last valid day of the resulting month (so 31 Jan + 1 month = 28 Feb).
function addMonthsDate(start, months) {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  const baseDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(baseDay, lastDay));
  return d.toISOString().slice(0, 10);
}

// Days between two ISO date strings (or Dates). Positive = b is in the future
// relative to a.
function daysBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  const oneDay = 24 * 60 * 60 * 1000;
  // Floor to midnight UTC to avoid DST issues.
  const flatA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const flatB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((flatB - flatA) / oneDay);
}

async function generateWarrantyNumber(client, year = new Date().getFullYear()) {
  const { formatted } = await nextDocumentNumber(client, 'WRN', year, {
    padWidth: 5,
  });
  return formatted;
}

async function generateClaimNumber(client, year = new Date().getFullYear()) {
  const { formatted } = await nextDocumentNumber(client, 'CLM', year, {
    padWidth: 5,
  });
  return formatted;
}

// Throws BIZ_DUPLICATE_SERIAL if another active warranty exists for this
// (productId, serialNumber) combination. excludeWarrantyId lets callers
// re-validate during updates.
async function assertSerialUnique(
  client,
  { productId, serialNumber, excludeWarrantyId = null },
) {
  if (!serialNumber || !productId) return;
  const params = [productId, serialNumber];
  let sql = `SELECT id, warranty_number FROM warranties
              WHERE product_id = $1
                AND serial_number = $2
                AND status = 'active'`;
  if (excludeWarrantyId) {
    sql += ` AND id <> $3`;
    params.push(excludeWarrantyId);
  }
  const { rows } = await client.query(sql, params);
  if (rows.length) {
    throw new AppError(
      ERROR_CODES.BIZ_DUPLICATE_SERIAL,
      `Serial ${serialNumber} is already covered by active warranty ${rows[0].warranty_number}.`,
      { status: 409, details: { existingWarrantyId: rows[0].id } },
    );
  }
}

// Auto-creates warranties for every line item on a confirmed invoice that has
// product.default_warranty_months > 0. Returns the inserted warranty rows.
// Designed to be called inside an existing transaction (or stand-alone with
// query()). To keep the confirmInvoice() flow simple we accept either a
// connected client or query directly.
async function createWarrantiesFromInvoice(invoiceId, { actorId = null, io = null } = {}) {
  return withTransaction(async (client) => {
    const { rows: invRows } = await client.query(
      `SELECT id, invoice_number, customer_id, created_by, confirmed_at,
              created_at, pc_identifier
         FROM invoices
        WHERE id = $1`,
      [invoiceId],
    );
    if (!invRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Invoice not found.', {
        status: 404,
      });
    }
    const invoice = invRows[0];
    const employeeId = actorId || invoice.created_by;

    const { rows: items } = await client.query(
      `SELECT ii.*, p.default_warranty_months, p.name AS product_name
         FROM invoice_items ii
         LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = $1
        ORDER BY ii.position ASC, ii.created_at ASC`,
      [invoiceId],
    );

    // Skip items whose product already has a customer warranty linked to this
    // invoice item (idempotency — re-running this fn after retries shouldn't
    // create duplicates).
    const { rows: existing } = await client.query(
      `SELECT invoice_item_id FROM warranties
        WHERE invoice_id = $1 AND warranty_type = 'customer'`,
      [invoiceId],
    );
    const seenItemIds = new Set(existing.map((r) => r.invoice_item_id));

    const startDate = (invoice.confirmed_at || invoice.created_at || new Date())
      .toISOString
      ? new Date(invoice.confirmed_at || invoice.created_at).toISOString().slice(0, 10)
      : String(invoice.confirmed_at || invoice.created_at).slice(0, 10);

    const created = [];
    for (const item of items) {
      if (seenItemIds.has(item.id)) continue;
      const months = Number(item.default_warranty_months || 0);
      if (months <= 0) continue;

      const endDate = addMonthsDate(startDate, months);
      if (!endDate) continue;

      // Serial uniqueness — best-effort. Bail loudly so the cashier sees the
      // problem before confirmation completes; the outer transaction will roll
      // back the invoice if that's the strategy. Callers in Phase 8 catch
      // BIZ_DUPLICATE_SERIAL and surface it to the UI.
      try {
        await assertSerialUnique(client, {
          productId: item.product_id,
          serialNumber: item.serial_number,
        });
      } catch (err) {
        if (err.code === ERROR_CODES.BIZ_DUPLICATE_SERIAL) throw err;
        throw err;
      }

      const warrantyNumber = await generateWarrantyNumber(client);

      const { rows: ins } = await client.query(
        `INSERT INTO warranties (
          warranty_number, product_id, variant_id, invoice_id, invoice_item_id,
          customer_id, serial_number, warranty_type, start_date, end_date,
          duration_months, terms, status, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'customer',$8,$9,$10,$11,'active',$12)
        RETURNING *`,
        [
          warrantyNumber,
          item.product_id,
          item.variant_id,
          invoiceId,
          item.id,
          invoice.customer_id,
          item.serial_number || null,
          startDate,
          endDate,
          months,
          null,
          employeeId,
        ],
      );
      created.push(ins[0]);

      await logActivity({
        entityType: 'warranty',
        entityId: ins[0].id,
        action: 'warranty.created',
        performedBy: employeeId,
        notes: `Auto-created from invoice ${invoice.invoice_number}`,
        newValue: { invoiceId, productId: item.product_id, months },
      });
    }

    if (io && created.length) {
      io.emit('warranty_created_batch', {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        count: created.length,
        at: new Date().toISOString(),
      });
    }

    return created;
  });
}

// Create a manual warranty (typically for supplier-issued items or post-sale
// captures where the auto-creation didn't happen).
async function createManualWarranty({
  productId,
  variantId = null,
  customerId = null,
  invoiceId = null,
  invoiceItemId = null,
  purchaseOrderId = null,
  supplierId = null,
  serialNumber = null,
  warrantyType = 'customer',
  startDate,
  durationMonths,
  terms = null,
  createdBy = null,
  io = null,
}) {
  if (!productId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Product is required.');
  }
  if (!startDate) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Start date is required.');
  }
  if (!durationMonths || Number(durationMonths) <= 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Duration must be a positive number of months.',
    );
  }

  const endDate = addMonthsDate(startDate, Number(durationMonths));

  return withTransaction(async (client) => {
    await assertSerialUnique(client, { productId, serialNumber });
    const warrantyNumber = await generateWarrantyNumber(client);
    const { rows } = await client.query(
      `INSERT INTO warranties (
        warranty_number, product_id, variant_id, invoice_id, invoice_item_id,
        customer_id, purchase_order_id, supplier_id, serial_number, warranty_type,
        start_date, end_date, duration_months, terms, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15)
      RETURNING *`,
      [
        warrantyNumber,
        productId,
        variantId,
        invoiceId,
        invoiceItemId,
        customerId,
        purchaseOrderId,
        supplierId,
        serialNumber || null,
        warrantyType,
        startDate,
        endDate,
        Number(durationMonths),
        terms,
        createdBy,
      ],
    );
    const warranty = rows[0];

    await logActivity({
      entityType: 'warranty',
      entityId: warranty.id,
      action: 'warranty.created',
      performedBy: createdBy,
      notes: 'Manual warranty created',
      newValue: { productId, durationMonths, serialNumber },
    });

    if (io) {
      io.emit('warranty_created', {
        warrantyId: warranty.id,
        warrantyNumber: warranty.warranty_number,
        productId,
        customerId,
        at: new Date().toISOString(),
      });
    }
    return warranty;
  });
}

// Void all customer-warranties that came from a cancelled invoice. Supplier
// warranties (purchased stock) stay alive — only the customer-facing
// warranties tied to the cancelled sale are affected.
async function voidWarrantiesForInvoice(invoiceId, { actorId = null, reason = null, io = null }) {
  const { rows } = await query(
    `UPDATE warranties
        SET status = 'void',
            voided_at = NOW(),
            voided_by = $2,
            void_reason = COALESCE($3, 'Invoice cancelled'),
            updated_at = NOW()
      WHERE invoice_id = $1
        AND warranty_type = 'customer'
        AND status = 'active'
      RETURNING id, warranty_number, customer_id`,
    [invoiceId, actorId, reason],
  );
  for (const w of rows) {
    await logActivity({
      entityType: 'warranty',
      entityId: w.id,
      action: 'warranty.voided',
      performedBy: actorId,
      notes: reason || 'Invoice cancelled',
    });
  }
  if (io && rows.length) {
    io.emit('warranty_voided_batch', {
      invoiceId,
      count: rows.length,
      at: new Date().toISOString(),
    });
  }
  return rows;
}

async function voidWarranty({ warrantyId, actorId, reason = null, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM warranties WHERE id = $1 FOR UPDATE`,
      [warrantyId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Warranty not found.', {
        status: 404,
      });
    }
    const w = rows[0];
    if (w.status === 'void') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Warranty already voided.',
        { status: 409 },
      );
    }
    await client.query(
      `UPDATE warranties
          SET status = 'void',
              voided_at = NOW(),
              voided_by = $1,
              void_reason = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [actorId, reason || null, warrantyId],
    );

    await logActivity({
      entityType: 'warranty',
      entityId: warrantyId,
      action: 'warranty.voided',
      performedBy: actorId,
      notes: reason || null,
    });

    if (io) {
      io.emit('warranty_voided', {
        warrantyId,
        warrantyNumber: w.warranty_number,
        voidedBy: actorId,
        at: new Date().toISOString(),
      });
    }
    return { warrantyId, warrantyNumber: w.warranty_number };
  });
}

async function createClaim({
  warrantyId,
  customerId = null,
  issueDescription,
  notes = null,
  createdBy = null,
  io = null,
}) {
  if (!issueDescription || !String(issueDescription).trim()) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Issue description is required.',
    );
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT w.*, p.name AS product_name
         FROM warranties w
         LEFT JOIN products p ON p.id = w.product_id
        WHERE w.id = $1
        FOR UPDATE`,
      [warrantyId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Warranty not found.', {
        status: 404,
      });
    }
    const w = rows[0];

    if (w.status === 'expired') {
      throw new AppError(
        ERROR_CODES.BIZ_WARRANTY_EXPIRED,
        undefined,
        { status: 409 },
      );
    }
    if (w.status === 'void') {
      throw new AppError(ERROR_CODES.BIZ_WARRANTY_VOID, undefined, { status: 409 });
    }
    if (w.status !== 'active' && w.status !== 'claimed') {
      throw new AppError(
        ERROR_CODES.BIZ_WARRANTY_NOT_ACTIVE,
        undefined,
        { status: 409 },
      );
    }

    const claimNumber = await generateClaimNumber(client);
    const customer = customerId || w.customer_id || null;
    const { rows: ins } = await client.query(
      `INSERT INTO warranty_claims (
        claim_number, warranty_id, customer_id, claim_date, issue_description,
        status, notes, created_by
      ) VALUES ($1,$2,$3,CURRENT_DATE,$4,'open',$5,$6)
      RETURNING *`,
      [claimNumber, warrantyId, customer, issueDescription, notes, createdBy],
    );
    const claim = ins[0];

    await logActivity({
      entityType: 'warranty_claim',
      entityId: claim.id,
      action: 'warranty_claim.created',
      performedBy: createdBy,
      newValue: { warrantyId, claimNumber },
      notes: issueDescription,
    });

    if (io) {
      const payload = {
        claimId: claim.id,
        claimNumber,
        warrantyId,
        warrantyNumber: w.warranty_number,
        productId: w.product_id,
        productName: w.product_name,
        customerId: customer,
        createdBy,
        at: new Date().toISOString(),
      };
      io.to('role:Manager').emit('warranty_claim_created', payload);
      io.to('role:Admin').emit('warranty_claim_created', payload);
    }
    try {
      await notificationService.notifyManagersAndAdmins({
        type: 'warranty.claim_created',
        category: 'warranty',
        severity: 'info',
        title: `Warranty claim: ${claimNumber}`,
        message: `${w.product_name || 'Product'} — claim filed against warranty ${w.warranty_number}.`,
        referenceType: 'warranty_claim',
        referenceId: claim.id,
        actionUrl: `/warranty-claims`,
        createdBy,
        skipForUserId: createdBy,
      });
    } catch (_e) { /* best-effort */ }
    return claim;
  });
}

// Build the zero-value replacement invoice that records the swap. We reuse
// the invoiceService helpers conceptually but write the rows directly to
// keep this self-contained and atomic with the warranty changes.
async function buildReplacementInvoice(
  client,
  { warranty, variantId, productId, employeeId, pcIdentifier },
) {
  // Snapshot variant + product info for the replacement line.
  const { rows: vRows } = await client.query(
    `SELECT v.id, v.product_id, v.sku, v.selling_price, v.cost_price,
            p.name AS product_name, p.unit_label
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  if (!vRows.length) {
    throw new AppError(
      ERROR_CODES.RESOURCE_NOT_FOUND,
      'Replacement variant not found.',
      { status: 404 },
    );
  }
  const v = vRows[0];

  // Reserve invoice number using existing per-PC sequencing scheme.
  const year = new Date().getFullYear();
  const scope = (pcIdentifier || 'WRN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { formatted: invoiceNumber } = await nextDocumentNumber(
    client,
    'INV',
    year,
    { scope: scope.slice(0, 6) || 'WRN', padWidth: 5 },
  );

  const { rows: inv } = await client.query(
    `INSERT INTO invoices (
      invoice_number, customer_id, status, payment_status,
      subtotal, discount_amount, tax_rate, taxable_amount, tax_amount,
      total, amount_paid, balance_due,
      pc_identifier, notes, created_by, confirmed_by, confirmed_at,
      invoice_discount
    ) VALUES (
      $1,$2,'confirmed','paid',
      0,0,0,0,0,
      0,0,0,
      $3,$4,$5,$5,NOW(),
      0
    ) RETURNING *`,
    [
      invoiceNumber,
      warranty.customer_id || null,
      pcIdentifier || null,
      `Warranty replacement for ${warranty.warranty_number}`,
      employeeId,
    ],
  );
  const invoice = inv[0];

  // Insert the zero-value replacement line.
  const { rows: attrRows } = await client.query(
    `SELECT a.name, a.unit, av.value
       FROM product_variant_attributes pva
       JOIN product_attribute_values av ON av.id = pva.attribute_value_id
       JOIN product_attributes a ON a.id = av.attribute_id
      WHERE pva.variant_id = $1`,
    [variantId],
  );
  const variantAttrs = attrRows.reduce((acc, r) => {
    acc[r.name] = r.unit ? `${r.value}${r.unit}` : r.value;
    return acc;
  }, {});
  const { rows: itemIns } = await client.query(
    `INSERT INTO invoice_items (
      invoice_id, product_id, variant_id, product_name, variant_attributes,
      sku, unit_label, quantity, unit_price, cost_price_at_time,
      discount_percent, discount_amount, line_subtotal, line_total, position,
      serial_number
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,$8,0,0,0,0,0,$9)
    RETURNING id`,
    [
      invoice.id,
      v.product_id,
      v.id,
      v.product_name,
      JSON.stringify(variantAttrs),
      v.sku,
      v.unit_label || 'pcs',
      Number(v.cost_price || 0),
      null,
    ],
  );
  const newItemId = itemIns[0].id;

  // History row for the new invoice.
  await client.query(
    `INSERT INTO invoice_history (invoice_id, action, performed_by, notes)
     VALUES ($1, 'created', $2, $3)`,
    [invoice.id, employeeId, `Warranty replacement for ${warranty.warranty_number}`],
  );
  await client.query(
    `INSERT INTO invoice_history (invoice_id, action, performed_by)
     VALUES ($1, 'confirmed', $2)`,
    [invoice.id, employeeId],
  );

  return { invoice, replacementVariant: v, replacementInvoiceItemId: newItemId };
}

async function resolveWarrantyClaim({
  claimId,
  resolution, // 'replaced' | 'repaired' | 'rejected'
  notes = null,
  replacementVariantId = null,
  pcIdentifier = null,
  managerId,
  io = null,
}) {
  if (!['replaced', 'repaired', 'rejected'].includes(resolution)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid resolution. Must be one of: replaced, repaired, rejected.',
    );
  }

  return withTransaction(async (client) => {
    const { rows: claimRows } = await client.query(
      `SELECT c.*, w.product_id AS warranty_product_id,
              w.variant_id AS warranty_variant_id,
              w.customer_id AS warranty_customer_id,
              w.warranty_number, w.supplier_id, w.purchase_order_id,
              w.duration_months
         FROM warranty_claims c
         JOIN warranties w ON w.id = c.warranty_id
        WHERE c.id = $1
        FOR UPDATE`,
      [claimId],
    );
    if (!claimRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Claim not found.', {
        status: 404,
      });
    }
    const claim = claimRows[0];
    if (claim.status === 'resolved' || claim.status === 'rejected') {
      throw new AppError(
        ERROR_CODES.BIZ_CLAIM_ALREADY_RESOLVED,
        undefined,
        { status: 409 },
      );
    }

    let stockEmits = [];
    let replacementInvoiceId = null;
    let newWarrantyId = null;

    if (resolution === 'replaced') {
      const variantId = replacementVariantId || claim.warranty_variant_id;
      if (!variantId) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'A replacement variant is required.',
        );
      }
      const productId = claim.warranty_product_id;

      // Build the zero-value invoice for the replacement.
      const built = await buildReplacementInvoice(client, {
        warranty: {
          customer_id: claim.warranty_customer_id,
          warranty_number: claim.warranty_number,
        },
        variantId,
        productId,
        employeeId: managerId,
        pcIdentifier,
      });
      replacementInvoiceId = built.invoice.id;

      // Deduct stock for the replacement item. We hand the open client to
      // applyStockMovement so the entire claim transaction stays atomic.
      const { variant } = await applyStockMovement({
        client,
        variantId,
        productId,
        type: 'sale',
        quantity: 1,
        referenceType: 'invoice',
        referenceId: replacementInvoiceId,
        employeeId: managerId,
        notes: `Warranty replacement: ${claim.warranty_number}`,
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
          referenceId: replacementInvoiceId,
        },
      });

      // Void the original warranty + create a new active warranty for the
      // replacement item using the original duration.
      await client.query(
        `UPDATE warranties
            SET status = 'claimed',
                updated_at = NOW()
          WHERE id = $1`,
        [claim.warranty_id],
      );

      const startDate = new Date().toISOString().slice(0, 10);
      const months = Number(claim.duration_months) || 12;
      const endDate = addMonthsDate(startDate, months);
      const newNumber = await generateWarrantyNumber(client);
      const { rows: newRows } = await client.query(
        `INSERT INTO warranties (
          warranty_number, product_id, variant_id, invoice_id, invoice_item_id,
          customer_id, serial_number, warranty_type, start_date, end_date,
          duration_months, terms, status, created_by, supplier_id, purchase_order_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'customer',$8,$9,$10,$11,'active',$12,$13,$14)
        RETURNING id, warranty_number`,
        [
          newNumber,
          productId,
          variantId,
          replacementInvoiceId,
          built.replacementInvoiceItemId,
          claim.warranty_customer_id,
          null, // serial is unknown for the replacement at this point
          startDate,
          endDate,
          months,
          'Replacement under warranty',
          managerId,
          claim.supplier_id,
          claim.purchase_order_id,
        ],
      );
      newWarrantyId = newRows[0].id;

      await logActivity({
        entityType: 'warranty',
        entityId: newWarrantyId,
        action: 'warranty.created',
        performedBy: managerId,
        notes: `Replacement issued under claim ${claim.claim_number}`,
        newValue: { previousWarrantyId: claim.warranty_id },
      });
    } else if (resolution === 'repaired') {
      // Warranty continues unchanged. No stock movement.
    } else if (resolution === 'rejected') {
      if (!notes || !String(notes).trim()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'A rejection reason is required.',
        );
      }
    }

    // Resolve the claim row.
    const { rows: updated } = await client.query(
      `UPDATE warranty_claims
          SET resolution = $1,
              status = CASE WHEN $1 = 'rejected' THEN 'rejected' ELSE 'resolved' END,
              resolved_by = $2,
              resolved_date = CURRENT_DATE,
              notes = COALESCE(NULLIF($3,''), notes),
              replacement_invoice_id = $4,
              supplier_claim_raised = CASE
                WHEN $1 = 'replaced' AND $5::uuid IS NOT NULL THEN true
                ELSE supplier_claim_raised
              END,
              updated_at = NOW()
        WHERE id = $6
        RETURNING *`,
      [
        resolution,
        managerId,
        notes || null,
        replacementInvoiceId,
        claim.supplier_id || null,
        claimId,
      ],
    );

    await logActivity({
      entityType: 'warranty_claim',
      entityId: claimId,
      action: 'warranty_claim.resolved',
      performedBy: managerId,
      newValue: { resolution, replacementInvoiceId },
      notes,
    });

    return {
      claim: updated[0],
      replacementInvoiceId,
      newWarrantyId,
      stockEmits,
    };
  }).then((result) => {
    if (io) {
      for (const e of result.stockEmits) {
        if (e) io.emit(e.event, e.payload);
      }
      io.emit('warranty_claim_resolved', {
        claimId,
        resolution,
        resolvedBy: managerId,
        replacementInvoiceId: result.replacementInvoiceId,
        newWarrantyId: result.newWarrantyId,
        at: new Date().toISOString(),
      });
    }
    if (result.claim && result.claim.created_by) {
      notificationService
        .notifyUser(result.claim.created_by, {
          type: 'warranty.claim_resolved',
          category: 'warranty',
          severity: resolution === 'rejected' ? 'warning' : 'info',
          title: `Claim ${result.claim.claim_number} ${resolution}`,
          message:
            resolution === 'replaced'
              ? 'A replacement has been issued.'
              : resolution === 'repaired'
                ? 'Item marked as repaired under warranty.'
                : 'The claim was rejected.',
          referenceType: 'warranty_claim',
          referenceId: claimId,
          actionUrl: `/warranty-claims`,
          createdBy: managerId,
        })
        .catch(() => {});
    }
    return result;
  });
}

async function raiseSupplierClaim({ claimId, actorId, notes = null, io = null }) {
  const { rows } = await query(
    `UPDATE warranty_claims
        SET supplier_claim_raised = true,
            notes = COALESCE(NULLIF($1,''), notes),
            updated_at = NOW()
      WHERE id = $2
      RETURNING id, claim_number, supplier_claim_raised`,
    [notes || null, claimId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Claim not found.', {
      status: 404,
    });
  }
  await logActivity({
    entityType: 'warranty_claim',
    entityId: claimId,
    action: 'warranty_claim.supplier_raised',
    performedBy: actorId,
    notes,
  });
  if (io) {
    io.to('role:Manager').emit('warranty_claim_updated', {
      claimId,
      supplier_claim_raised: true,
      at: new Date().toISOString(),
    });
  }
  return rows[0];
}

async function setSupplierClaimResolved({ claimId, actorId, resolved, notes = null, io = null }) {
  const { rows } = await query(
    `UPDATE warranty_claims
        SET supplier_claim_resolved = $1,
            notes = COALESCE(NULLIF($2,''), notes),
            updated_at = NOW()
      WHERE id = $3
      RETURNING id, claim_number, supplier_claim_resolved`,
    [!!resolved, notes || null, claimId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Claim not found.', {
      status: 404,
    });
  }
  await logActivity({
    entityType: 'warranty_claim',
    entityId: claimId,
    action: 'warranty_claim.supplier_resolved',
    performedBy: actorId,
    notes,
  });
  if (io) {
    io.to('role:Manager').emit('warranty_claim_updated', {
      claimId,
      supplier_claim_resolved: !!resolved,
      at: new Date().toISOString(),
    });
  }
  return rows[0];
}

// Sweep active warranties whose end_date is in the past and flip them to
// 'expired'. Called by the daily job. Returns count.
async function expireWarranties({ io = null } = {}) {
  const { rows } = await query(
    `UPDATE warranties
        SET status = 'expired',
            updated_at = NOW()
      WHERE status = 'active'
        AND end_date < CURRENT_DATE
      RETURNING id, warranty_number, customer_id`,
  );
  for (const w of rows) {
    await logActivity({
      entityType: 'warranty',
      entityId: w.id,
      action: 'warranty.expired',
      performedBy: null,
      notes: 'Auto-expired by daily sweep',
    });
  }
  if (io && rows.length) {
    io.emit('warranty_expired_batch', {
      count: rows.length,
      at: new Date().toISOString(),
    });
  }
  return { count: rows.length, ids: rows.map((r) => r.id) };
}

// Notify managers/admins about warranties expiring within `days` days.
async function notifyExpiringSoon({ days = 30, io }) {
  if (!io) return { count: 0 };
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM warranties
      WHERE status = 'active'
        AND end_date >= CURRENT_DATE
        AND end_date <= CURRENT_DATE + ($1::int) * INTERVAL '1 day'`,
    [days],
  );
  const count = rows[0].count;
  if (count > 0) {
    const payload = { count, withinDays: days, at: new Date().toISOString() };
    io.to('role:Manager').emit('warranty_expiring_soon', payload);
    io.to('role:Admin').emit('warranty_expiring_soon', payload);
  }
  return { count };
}

// Shape a warranty row for API responses. Computes days remaining + a
// frontend-friendly "expiring soon" hint without touching the DB.
function shapeWarranty(row, extra = {}) {
  if (!row) return null;
  const today = new Date();
  const daysRemaining = daysBetween(today, row.end_date);
  const expiringSoon = row.status === 'active' && daysRemaining >= 0 && daysRemaining <= 30;
  return {
    id: row.id,
    warrantyNumber: row.warranty_number,
    productId: row.product_id,
    productName: row.product_name || null,
    productImage: row.product_image_path || null,
    variantId: row.variant_id,
    variantSku: row.variant_sku || null,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number || null,
    invoiceItemId: row.invoice_item_id,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    purchaseOrderId: row.purchase_order_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || null,
    serialNumber: row.serial_number,
    warrantyType: row.warranty_type,
    startDate: row.start_date,
    endDate: row.end_date,
    durationMonths: row.duration_months,
    terms: row.terms,
    status: row.status,
    daysRemaining,
    expiringSoon,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function shapeClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    claimNumber: row.claim_number,
    warrantyId: row.warranty_id,
    warrantyNumber: row.warranty_number || null,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    productId: row.product_id || null,
    productName: row.product_name || null,
    claimDate: row.claim_date,
    issueDescription: row.issue_description,
    resolution: row.resolution,
    resolvedBy: row.resolved_by,
    resolvedByUsername: row.resolved_by_username || null,
    resolvedDate: row.resolved_date,
    replacementInvoiceId: row.replacement_invoice_id,
    replacementInvoiceNumber: row.replacement_invoice_number || null,
    supplierClaimRaised: row.supplier_claim_raised,
    supplierClaimResolved: row.supplier_claim_resolved,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createWarrantiesFromInvoice,
  createManualWarranty,
  voidWarranty,
  voidWarrantiesForInvoice,
  createClaim,
  resolveWarrantyClaim,
  raiseSupplierClaim,
  setSupplierClaimResolved,
  expireWarranties,
  notifyExpiringSoon,
  shapeWarranty,
  shapeClaim,
  addMonthsDate,
  daysBetween,
};
