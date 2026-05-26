const { z } = require('zod');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { query } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    isActive: row.is_active,
    billsCount: Number(row.bills_count || 0),
    expensesCount: Number(row.expenses_count || 0),
    createdAt: row.created_at,
  };
}

async function list(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM bills b WHERE b.category_id = c.id) AS bills_count,
              (SELECT COUNT(*)::int FROM one_time_expenses e WHERE e.category_id = c.id) AS expenses_count
         FROM expense_categories c
         ORDER BY c.type ASC, c.name ASC`,
    );
    return ok(res, rows.map(shape));
  } catch (err) {
    next(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['recurring', 'one_time']),
  icon: z.string().max(10).optional().nullable(),
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    try {
      const { rows } = await query(
        `INSERT INTO expense_categories (name, type, icon)
         VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.type, body.icon || null],
      );
      await logActivity({
        entityType: 'expense_category',
        entityId: rows[0].id,
        action: 'category.created',
        performedBy: req.user.id,
        newValue: body,
      });
      return created(res, shape(rows[0]));
    } catch (e) {
      if (e?.code === '23505') {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'A category with that name already exists.',
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['recurring', 'one_time']).optional(),
  icon: z.string().max(10).nullable().optional(),
  isActive: z.boolean().optional(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { rows: existing } = await query(
      `SELECT * FROM expense_categories WHERE id = $1`,
      [req.params.id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const patch = {
      name: body.name ?? existing[0].name,
      type: body.type ?? existing[0].type,
      icon: body.icon !== undefined ? body.icon : existing[0].icon,
      is_active: body.isActive !== undefined ? body.isActive : existing[0].is_active,
    };
    const { rows } = await query(
      `UPDATE expense_categories
          SET name=$1, type=$2, icon=$3, is_active=$4
        WHERE id=$5 RETURNING *`,
      [patch.name, patch.type, patch.icon, patch.is_active, req.params.id],
    );
    await logActivity({
      entityType: 'expense_category',
      entityId: req.params.id,
      action: 'category.updated',
      performedBy: req.user.id,
      newValue: patch,
    });
    return ok(res, shape(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { rows: usage } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM bills WHERE category_id = $1) AS bills,
         (SELECT COUNT(*)::int FROM one_time_expenses WHERE category_id = $1) AS expenses`,
      [req.params.id],
    );
    if ((usage[0].bills || 0) + (usage[0].expenses || 0) > 0) {
      throw new AppError(ERROR_CODES.BIZ_CATEGORY_IN_USE, undefined, { status: 409 });
    }
    const { rowCount } = await query(
      `DELETE FROM expense_categories WHERE id = $1`,
      [req.params.id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    await logActivity({
      entityType: 'expense_category',
      entityId: req.params.id,
      action: 'category.deleted',
      performedBy: req.user.id,
    });
    return ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
