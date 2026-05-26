const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const {
  createManualWarranty,
  voidWarranty,
  shapeWarranty,
  shapeClaim,
} = require('../services/warrantyService');
const { logActivity } = require('../utils/activityLog');

// Common SELECT used by list/get endpoints — joins the data the UI cares
// about so we never have to roundtrip a second query per row.
const WARRANTY_SELECT = `
  SELECT w.*,
         p.name AS product_name,
         p.image_path AS product_image_path,
         v.sku AS variant_sku,
         i.invoice_number AS invoice_number,
         c.name AS customer_name,
         c.phone AS customer_phone,
         s.name AS supplier_name,
         u.username AS created_by_username
    FROM warranties w
    LEFT JOIN products p ON p.id = w.product_id
    LEFT JOIN product_variants v ON v.id = w.variant_id
    LEFT JOIN invoices i ON i.id = w.invoice_id
    LEFT JOIN customers c ON c.id = w.customer_id
    LEFT JOIN suppliers s ON s.id = w.supplier_id
    LEFT JOIN users u ON u.id = w.created_by
`;

function buildListFilters(req) {
  const parts = [];
  const params = [];
  let i = 1;

  if (req.query.status) {
    parts.push(`w.status = $${i++}`);
    params.push(req.query.status);
  }
  if (req.query.customer_id) {
    parts.push(`w.customer_id = $${i++}`);
    params.push(req.query.customer_id);
  }
  if (req.query.product_id) {
    parts.push(`w.product_id = $${i++}`);
    params.push(req.query.product_id);
  }
  if (req.query.supplier_id) {
    parts.push(`w.supplier_id = $${i++}`);
    params.push(req.query.supplier_id);
  }
  if (req.query.warranty_type) {
    parts.push(`w.warranty_type = $${i++}`);
    params.push(req.query.warranty_type);
  }
  if (req.query.expiring_soon === 'true') {
    parts.push(`w.status = 'active'`);
    parts.push(`w.end_date >= CURRENT_DATE`);
    parts.push(`w.end_date <= CURRENT_DATE + INTERVAL '30 days'`);
  }
  if (req.query.expired === 'true') {
    parts.push(`(w.status = 'expired' OR w.end_date < CURRENT_DATE)`);
  }
  if (req.query.search) {
    parts.push(
      `(w.warranty_number ILIKE $${i} OR w.serial_number ILIKE $${i}
        OR p.name ILIKE $${i} OR c.name ILIKE $${i} OR c.phone ILIKE $${i}
        OR i.invoice_number ILIKE $${i})`,
    );
    params.push(`%${req.query.search}%`);
    i++;
  }
  return { where: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

async function list(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { where, params } = buildListFilters(req);

    const sort = (req.query.sort || 'end_date_asc').toString();
    let orderBy = 'w.end_date ASC';
    if (sort === 'created_desc') orderBy = 'w.created_at DESC';
    if (sort === 'end_date_desc') orderBy = 'w.end_date DESC';
    if (sort === 'product') orderBy = 'p.name ASC NULLS LAST';
    if (sort === 'customer') orderBy = 'c.name ASC NULLS LAST';

    const { rows } = await query(
      `${WARRANTY_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM warranties w
         LEFT JOIN products p ON p.id = w.product_id
         LEFT JOIN customers c ON c.id = w.customer_id
         LEFT JOIN invoices i ON i.id = w.invoice_id
         ${where}`,
      params,
    );

    return ok(
      res,
      rows.map((r) => shapeWarranty(r)),
      { total: totalRows[0].total, page, limit },
    );
  } catch (err) {
    next(err);
  }
}

async function summary(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
         COUNT(*) FILTER (WHERE status = 'active'
                          AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')::int AS expiring_soon_count,
         COUNT(*) FILTER (WHERE status = 'expired'
                          AND end_date >= date_trunc('year', CURRENT_DATE)::date)::int AS expired_this_year_count,
         COUNT(*) FILTER (WHERE status = 'active'
                          AND end_date BETWEEN CURRENT_DATE
                              AND (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date)::int AS expiring_this_month_count,
         COUNT(*) FILTER (WHERE status = 'claimed')::int AS claimed_count,
         COUNT(*) FILTER (WHERE status = 'void')::int AS void_count
       FROM warranties`,
    );
    const { rows: claimRows } = await query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open_claims
         FROM warranty_claims`,
    );
    return ok(res, {
      ...rows[0],
      open_claims: claimRows[0].open_claims,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${WARRANTY_SELECT} WHERE w.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const warranty = shapeWarranty(rows[0]);

    // Claims linked to this warranty.
    const { rows: claimRows } = await query(
      `SELECT c.*, w.warranty_number,
              p.name AS product_name,
              cust.name AS customer_name, cust.phone AS customer_phone,
              ru.username AS resolved_by_username,
              cu.username AS created_by_username,
              ri.invoice_number AS replacement_invoice_number
         FROM warranty_claims c
         JOIN warranties w ON w.id = c.warranty_id
         LEFT JOIN products p ON p.id = w.product_id
         LEFT JOIN customers cust ON cust.id = c.customer_id
         LEFT JOIN users ru ON ru.id = c.resolved_by
         LEFT JOIN users cu ON cu.id = c.created_by
         LEFT JOIN invoices ri ON ri.id = c.replacement_invoice_id
        WHERE c.warranty_id = $1
        ORDER BY c.created_at DESC`,
      [req.params.id],
    );

    // Linked supplier warranty (if any) — same product/serial originating
    // from a PO with a supplier-type warranty.
    let supplierWarranty = null;
    if (warranty.serialNumber && warranty.productId) {
      const { rows: sw } = await query(
        `${WARRANTY_SELECT}
           WHERE w.warranty_type = 'supplier'
             AND w.product_id = $1
             AND w.serial_number = $2
           LIMIT 1`,
        [warranty.productId, warranty.serialNumber],
      );
      if (sw.length) supplierWarranty = shapeWarranty(sw[0]);
    }

    return ok(res, {
      ...warranty,
      claims: claimRows.map((r) => shapeClaim(r)),
      supplierWarranty,
    });
  } catch (err) {
    next(err);
  }
}

const createSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  invoiceId: z.string().uuid().optional().nullable(),
  invoiceItemId: z.string().uuid().optional().nullable(),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  serialNumber: z.string().max(100).optional().nullable(),
  warrantyType: z.enum(['customer', 'supplier']).default('customer'),
  startDate: z.string().min(8),
  durationMonths: z.number().int().positive().max(600),
  terms: z.string().max(2000).optional().nullable(),
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const io = req.app.get('io');
    const warranty = await createManualWarranty({
      ...body,
      createdBy: req.user.id,
      io,
    });
    return created(res, shapeWarranty(warranty));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid warranty payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

const updateSchema = z.object({
  serialNumber: z.string().max(100).optional().nullable(),
  startDate: z.string().min(8).optional(),
  endDate: z.string().min(8).optional(),
  durationMonths: z.number().int().positive().max(600).optional(),
  terms: z.string().max(2000).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { rows } = await query(
      `SELECT * FROM warranties WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const current = rows[0];

    const fields = [];
    const params = [];
    let i = 1;
    function set(col, val) {
      fields.push(`${col} = $${i++}`);
      params.push(val);
    }
    if (body.serialNumber !== undefined) set('serial_number', body.serialNumber || null);
    if (body.startDate) set('start_date', body.startDate);
    if (body.endDate) set('end_date', body.endDate);
    if (body.durationMonths !== undefined) set('duration_months', body.durationMonths);
    if (body.terms !== undefined) set('terms', body.terms || null);
    if (body.customerId !== undefined) set('customer_id', body.customerId || null);

    if (!fields.length) return ok(res, shapeWarranty(current));

    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);
    await query(
      `UPDATE warranties SET ${fields.join(', ')} WHERE id = $${i}`,
      params,
    );

    await logActivity({
      entityType: 'warranty',
      entityId: req.params.id,
      action: 'warranty.updated',
      performedBy: req.user.id,
      newValue: body,
    });

    const { rows: updated } = await query(
      `${WARRANTY_SELECT} WHERE w.id = $1`,
      [req.params.id],
    );
    return ok(res, shapeWarranty(updated[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid warranty payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function voidOne(req, res, next) {
  try {
    const io = req.app.get('io');
    const result = await voidWarranty({
      warrantyId: req.params.id,
      actorId: req.user.id,
      reason: req.body?.reason || null,
      io,
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

// Fast lookup endpoint — searches by ANY of: serial, invoice number, customer
// name or phone, warranty number. Returns up to 10 matches.
async function lookup(req, res, next) {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return ok(res, []);
    const term = `%${q}%`;
    const { rows } = await query(
      `${WARRANTY_SELECT}
        WHERE w.warranty_number ILIKE $1
           OR w.serial_number ILIKE $1
           OR i.invoice_number ILIKE $1
           OR c.name ILIKE $1
           OR c.phone ILIKE $1
        ORDER BY w.created_at DESC
        LIMIT 20`,
      [term],
    );
    return ok(res, rows.map((r) => shapeWarranty(r)));
  } catch (err) {
    next(err);
  }
}

async function productStats(req, res, next) {
  try {
    const productId = req.params.productId;
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
         COUNT(*)::int AS total_count
         FROM warranties WHERE product_id = $1`,
      [productId],
    );
    const { rows: claimRows } = await query(
      `SELECT COUNT(*)::int AS total_claims,
              COUNT(*) FILTER (WHERE c.status IN ('open','in_progress'))::int AS open_claims
         FROM warranty_claims c
         JOIN warranties w ON w.id = c.warranty_id
        WHERE w.product_id = $1`,
      [productId],
    );
    const { rows: reasonRows } = await query(
      `SELECT issue_description FROM warranty_claims c
         JOIN warranties w ON w.id = c.warranty_id
        WHERE w.product_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [productId],
    );
    const total = rows[0].total_count || 0;
    const totalClaims = claimRows[0].total_claims || 0;
    const claimRate = total > 0 ? (totalClaims / total) * 100 : 0;
    return ok(res, {
      activeCount: rows[0].active_count || 0,
      totalCount: total,
      totalClaims,
      openClaims: claimRows[0].open_claims || 0,
      claimRatePct: Math.round(claimRate * 10) / 10,
      mostRecentReason: reasonRows[0]?.issue_description || null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  voidOne,
  lookup,
  summary,
  productStats,
};
