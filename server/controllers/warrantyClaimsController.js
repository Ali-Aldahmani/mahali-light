const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const {
  createClaim,
  resolveWarrantyClaim,
  raiseSupplierClaim,
  setSupplierClaimResolved,
  shapeClaim,
} = require('../services/warrantyService');
const { logActivity } = require('../utils/activityLog');

const CLAIM_SELECT = `
  SELECT c.*, w.warranty_number,
         p.id AS product_id, p.name AS product_name,
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
`;

async function list(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const parts = [];
    const params = [];
    let i = 1;

    if (req.query.status) {
      parts.push(`c.status = $${i++}`);
      params.push(req.query.status);
    }
    if (req.query.warranty_id) {
      parts.push(`c.warranty_id = $${i++}`);
      params.push(req.query.warranty_id);
    }
    if (req.query.customer_id) {
      parts.push(`c.customer_id = $${i++}`);
      params.push(req.query.customer_id);
    }
    if (req.query.resolution) {
      parts.push(`c.resolution = $${i++}`);
      params.push(req.query.resolution);
    }
    if (req.query.from) {
      parts.push(`c.claim_date >= $${i++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      parts.push(`c.claim_date <= $${i++}`);
      params.push(req.query.to);
    }
    if (req.query.supplier_raised === 'true') {
      parts.push(`c.supplier_claim_raised = true`);
    }
    if (req.query.search) {
      parts.push(
        `(c.claim_number ILIKE $${i} OR w.warranty_number ILIKE $${i}
          OR p.name ILIKE $${i} OR cust.name ILIKE $${i})`,
      );
      params.push(`%${req.query.search}%`);
      i++;
    }

    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
    const { rows } = await query(
      `${CLAIM_SELECT} ${where} ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const { rows: totalRows } = await query(
      `SELECT COUNT(*)::int AS total FROM warranty_claims c
         JOIN warranties w ON w.id = c.warranty_id
         LEFT JOIN products p ON p.id = w.product_id
         LEFT JOIN customers cust ON cust.id = c.customer_id
         ${where}`,
      params,
    );
    return ok(
      res,
      rows.map((r) => shapeClaim(r)),
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
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
         COUNT(*) FILTER (WHERE status = 'resolved'
                          AND resolved_date >= date_trunc('month', CURRENT_DATE)::date)::int AS resolved_this_month,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
         COUNT(*) FILTER (WHERE supplier_claim_raised = true
                          AND supplier_claim_resolved = false)::int AS supplier_pending
       FROM warranty_claims`,
    );
    return ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, shapeClaim(rows[0]));
  } catch (err) {
    next(err);
  }
}

const createSchema = z.object({
  warrantyId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  issueDescription: z.string().min(3).max(2000),
  notes: z.string().max(2000).optional().nullable(),
});

async function createOne(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const io = req.app.get('io');
    const claim = await createClaim({
      ...body,
      createdBy: req.user.id,
      io,
    });
    const { rows } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [claim.id]);
    return created(res, shapeClaim(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid claim payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

const updateSchema = z.object({
  status: z.enum(['open', 'in_progress']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  issueDescription: z.string().min(3).max(2000).optional(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { rows: existing } = await query(
      `SELECT status FROM warranty_claims WHERE id = $1`,
      [req.params.id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (['resolved', 'rejected'].includes(existing[0].status)) {
      throw new AppError(
        ERROR_CODES.BIZ_CLAIM_ALREADY_RESOLVED,
        undefined,
        { status: 409 },
      );
    }
    const fields = [];
    const params = [];
    let i = 1;
    function set(col, val) {
      fields.push(`${col} = $${i++}`);
      params.push(val);
    }
    if (body.status !== undefined) set('status', body.status);
    if (body.notes !== undefined) set('notes', body.notes || null);
    if (body.issueDescription !== undefined) {
      set('issue_description', body.issueDescription);
    }
    if (!fields.length) {
      const { rows: cur } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
      return ok(res, shapeClaim(cur[0]));
    }
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);
    await query(
      `UPDATE warranty_claims SET ${fields.join(', ')} WHERE id = $${i}`,
      params,
    );
    await logActivity({
      entityType: 'warranty_claim',
      entityId: req.params.id,
      action: 'warranty_claim.updated',
      performedBy: req.user.id,
      newValue: body,
    });
    const { rows: cur } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
    return ok(res, shapeClaim(cur[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid claim payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

const resolveSchema = z.object({
  resolution: z.enum(['replaced', 'repaired', 'rejected']),
  notes: z.string().max(2000).optional().nullable(),
  replacementVariantId: z.string().uuid().optional().nullable(),
  pcIdentifier: z.string().max(50).optional().nullable(),
});

async function resolve(req, res, next) {
  try {
    const body = resolveSchema.parse(req.body || {});
    const io = req.app.get('io');
    await resolveWarrantyClaim({
      claimId: req.params.id,
      managerId: req.user.id,
      io,
      ...body,
    });
    const { rows } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
    return ok(res, shapeClaim(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid resolution payload.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function raiseSupplier(req, res, next) {
  try {
    const io = req.app.get('io');
    await raiseSupplierClaim({
      claimId: req.params.id,
      actorId: req.user.id,
      notes: req.body?.notes || null,
      io,
    });
    const { rows } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
    return ok(res, shapeClaim(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function setSupplierResolved(req, res, next) {
  try {
    const io = req.app.get('io');
    await setSupplierClaimResolved({
      claimId: req.params.id,
      actorId: req.user.id,
      resolved: !!req.body?.resolved,
      notes: req.body?.notes || null,
      io,
    });
    const { rows } = await query(`${CLAIM_SELECT} WHERE c.id = $1`, [req.params.id]);
    return ok(res, shapeClaim(rows[0]));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  summary,
  getOne,
  createOne,
  update,
  resolve,
  raiseSupplier,
  setSupplierResolved,
};
