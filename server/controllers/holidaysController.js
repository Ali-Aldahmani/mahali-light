const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

async function list(req, res, next) {
  try {
    const { year, from, to } = listSchema.parse(req.query || {});
    const parts = [];
    const params = [];
    let i = 1;
    if (year) {
      parts.push(
        `date >= make_date($${i}, 1, 1) AND date < make_date($${i} + 1, 1, 1)`,
      );
      params.push(year);
      i += 1;
    }
    if (from) {
      parts.push(`date >= $${i++}::date`);
      params.push(from);
    }
    if (to) {
      parts.push(`date <= $${i++}::date`);
      params.push(to);
    }
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT h.*, u.username AS created_by_username
         FROM holidays h
         LEFT JOIN users u ON u.id = h.created_by
         ${where}
         ORDER BY date ASC`,
      params,
    );
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
        type: r.type,
        createdBy: r.created_by,
        createdByUsername: r.created_by_username,
        createdAt: r.created_at,
      })),
    );
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  date: z.string(),
  type: z.enum(['public', 'company']).optional().default('public'),
});

async function add(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    try {
      const { rows } = await query(
        `INSERT INTO holidays (name, date, type, created_by)
         VALUES ($1, $2::date, $3, $4)
         RETURNING *`,
        [body.name.trim(), body.date, body.type, req.user.id],
      );
      await logActivity({
        entityType: 'holiday',
        entityId: rows[0].id,
        action: 'holiday.added',
        performedBy: req.user.id,
        newValue: { name: body.name, date: body.date, type: body.type },
      });
      const io = req.app.get('io');
      if (io) io.emit('holiday_added', { id: rows[0].id, name: rows[0].name, date: body.date });
      return created(res, rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        throw new AppError(ERROR_CODES.BIZ_HOLIDAY_DUPLICATE, undefined, { status: 409 });
      }
      throw e;
    }
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { rows } = await query(
      `DELETE FROM holidays WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    await logActivity({
      entityType: 'holiday',
      entityId: req.params.id,
      action: 'holiday.removed',
      performedBy: req.user.id,
      oldValue: { name: rows[0].name, date: rows[0].date },
    });
    const io = req.app.get('io');
    if (io) io.emit('holiday_removed', { id: req.params.id });
    return ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, add, remove };
