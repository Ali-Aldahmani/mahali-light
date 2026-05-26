const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const createSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().max(100).optional().nullable().or(z.literal('')),
  roleTitle: z.string().max(100).optional().nullable(),
  hireDate: z.string().optional().nullable(),
  shiftStart: z.string().regex(timeRegex, 'Invalid time').optional().default('09:00'),
  shiftEnd: z.string().regex(timeRegex, 'Invalid time').optional().default('18:00'),
  standardHours: z.number().min(0).max(24).optional().default(8),
  lateThresholdMins: z.number().int().min(0).max(180).optional().default(15),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial();

const SELECT = `
  SELECT id, name, phone, email, role_title, hire_date,
         shift_start, shift_end, standard_hours, late_threshold_mins,
         is_active, created_at, updated_at
    FROM employees
`;

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    roleTitle: row.role_title,
    hireDate: row.hire_date,
    shiftStart: typeof row.shift_start === 'string' ? row.shift_start : row.shift_start?.toString(),
    shiftEnd: typeof row.shift_end === 'string' ? row.shift_end : row.shift_end?.toString(),
    standardHours: Number(row.standard_hours),
    lateThresholdMins: row.late_threshold_mins,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req);
    const search = (req.query.search || '').toString().trim();

    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`,
      );
    }
    if (req.query.isActive === 'true') where.push('is_active = true');
    if (req.query.isActive === 'false') where.push('is_active = false');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM employees ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${SELECT} ${whereSql} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return ok(res, rows.map(shape), { page, limit, total: countRows[0].total });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${SELECT} WHERE id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const { rows } = await query(
      `INSERT INTO employees
         (name, phone, email, role_title, hire_date, shift_start, shift_end,
          standard_hours, late_threshold_mins, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        body.name,
        body.phone || null,
        body.email || null,
        body.roleTitle || null,
        body.hireDate || null,
        body.shiftStart,
        body.shiftEnd,
        body.standardHours,
        body.lateThresholdMins,
        body.isActive ?? true,
      ],
    );

    await logActivity({
      entityType: 'employee',
      entityId: rows[0].id,
      action: 'employee.created',
      performedBy: req.user.id,
      newValue: shape(rows[0]),
    });

    return created(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: existing } = await query(`${SELECT} WHERE id = $1`, [id]);
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const map = {
      name: 'name',
      phone: 'phone',
      email: 'email',
      roleTitle: 'role_title',
      hireDate: 'hire_date',
      shiftStart: 'shift_start',
      shiftEnd: 'shift_end',
      standardHours: 'standard_hours',
      lateThresholdMins: 'late_threshold_mins',
      isActive: 'is_active',
    };

    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(map)) {
      if (body[key] !== undefined) {
        params.push(body[key] === '' ? null : body[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return ok(res, shape(existing[0]));
    sets.push('updated_at = NOW()');
    params.push(id);

    await query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    await logActivity({
      entityType: 'employee',
      entityId: id,
      action: 'employee.updated',
      performedBy: req.user.id,
      oldValue: shape(existing[0]),
      newValue: body,
    });

    const { rows } = await query(`${SELECT} WHERE id = $1`, [id]);
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function softDelete(req, res, next) {
  try {
    const { id } = req.params;
    const { rowCount } = await query(
      `UPDATE employees SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await logActivity({
      entityType: 'employee',
      entityId: id,
      action: 'employee.deactivated',
      performedBy: req.user.id,
    });

    return ok(res, { id, isActive: false });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, softDelete };
