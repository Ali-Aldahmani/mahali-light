const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

async function list(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT key, value, description, updated_at FROM settings ORDER BY key`,
    );
    return ok(
      res,
      rows.map((r) => ({
        key: r.key,
        value: r.value,
        description: r.description,
        updatedAt: r.updated_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT key, value, description, updated_at FROM settings WHERE key = $1`,
      [req.params.key],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, {
      key: rows[0].key,
      value: rows[0].value,
      description: rows[0].description,
      updatedAt: rows[0].updated_at,
    });
  } catch (err) {
    next(err);
  }
}

const updateSchema = z.object({
  value: z.any(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { key } = req.params;

    const { rows: existing } = await query(`SELECT key FROM settings WHERE key = $1`, [
      key,
    ]);
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await query(
      `UPDATE settings
          SET value = $1::jsonb,
              updated_at = NOW(),
              updated_by = $2
        WHERE key = $3`,
      [JSON.stringify(body.value), req.user.id, key],
    );

    await logActivity({
      entityType: 'setting',
      entityId: null,
      action: 'settings.updated',
      performedBy: req.user.id,
      notes: key,
      newValue: { key, value: body.value },
    });

    return ok(res, { key, value: body.value });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, update };
