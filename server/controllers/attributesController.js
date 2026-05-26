const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const createSchema = z.object({
  name: z.string().min(1).max(100),
  unit: z.string().max(20).nullable().optional(),
  values: z
    .array(
      z.object({
        value: z.string().min(1).max(100),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional()
    .default([]),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  unit: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
});

const addValueSchema = z.object({
  value: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
});

const reorderValuesSchema = z.object({
  values: z
    .array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() }))
    .min(1),
});

function shapeAttribute(row, values = []) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    isActive: row.is_active,
    createdAt: row.created_at,
    values,
  };
}

function shapeValue(row) {
  return { id: row.id, value: row.value, sortOrder: row.sort_order };
}

async function loadValues(attributeId) {
  const { rows } = await query(
    `SELECT id, value, sort_order FROM product_attribute_values
      WHERE attribute_id = $1 ORDER BY sort_order ASC, value ASC`,
    [attributeId],
  );
  return rows.map(shapeValue);
}

async function list(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT * FROM product_attributes ORDER BY name ASC`,
    );
    const data = await Promise.all(
      rows.map(async (r) => shapeAttribute(r, await loadValues(r.id))),
    );
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO product_attributes (name, unit) VALUES ($1,$2) RETURNING *`,
        [body.name, body.unit || null],
      );
      const attr = rows[0];
      for (let i = 0; i < body.values.length; i++) {
        const v = body.values[i];
        await client.query(
          `INSERT INTO product_attribute_values (attribute_id, value, sort_order)
           VALUES ($1,$2,$3)`,
          [attr.id, v.value, v.sortOrder ?? i + 1],
        );
      }
      return attr;
    });

    const values = await loadValues(result.id);
    await logActivity({
      entityType: 'attribute',
      entityId: result.id,
      action: 'attribute.created',
      performedBy: req.user.id,
      newValue: shapeAttribute(result, values),
    });
    return created(res, shapeAttribute(result, values));
  } catch (err) {
    if (err && err.code === '23505') {
      return next(
        new AppError(
          ERROR_CODES.RESOURCE_CONFLICT,
          'An attribute with this name already exists.',
          { status: 409 },
        ),
      );
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: existing } = await query(
      `SELECT * FROM product_attributes WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const sets = [];
    const params = [];
    if (body.name !== undefined) {
      params.push(body.name);
      sets.push(`name = $${params.length}`);
    }
    if (body.unit !== undefined) {
      params.push(body.unit || null);
      sets.push(`unit = $${params.length}`);
    }
    if (body.isActive !== undefined) {
      params.push(body.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length) {
      params.push(id);
      await query(
        `UPDATE product_attributes SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
    }

    await logActivity({
      entityType: 'attribute',
      entityId: id,
      action: 'attribute.updated',
      performedBy: req.user.id,
      newValue: body,
    });

    const { rows } = await query(`SELECT * FROM product_attributes WHERE id = $1`, [id]);
    const values = await loadValues(id);
    return ok(res, shapeAttribute(rows[0], values));
  } catch (err) {
    if (err && err.code === '23505') {
      return next(
        new AppError(
          ERROR_CODES.RESOURCE_CONFLICT,
          'An attribute with this name already exists.',
          { status: 409 },
        ),
      );
    }
    next(err);
  }
}

async function addValue(req, res, next) {
  try {
    const body = addValueSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: attr } = await query(`SELECT id FROM product_attributes WHERE id = $1`, [
      id,
    ]);
    if (!attr.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    let sortOrder = body.sortOrder;
    if (sortOrder === undefined) {
      const { rows } = await query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM product_attribute_values
          WHERE attribute_id = $1`,
        [id],
      );
      sortOrder = rows[0].next;
    }

    const { rows } = await query(
      `INSERT INTO product_attribute_values (attribute_id, value, sort_order)
       VALUES ($1,$2,$3) RETURNING id, value, sort_order`,
      [id, body.value, sortOrder],
    );

    await logActivity({
      entityType: 'attribute',
      entityId: id,
      action: 'attribute.value_added',
      performedBy: req.user.id,
      newValue: { value: body.value, sortOrder },
    });
    return created(res, shapeValue(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function removeValue(req, res, next) {
  try {
    const { id, valueId } = req.params;

    const { rows: usage } = await query(
      `SELECT COUNT(*)::int AS c FROM product_variant_attributes WHERE attribute_value_id = $1`,
      [valueId],
    );
    if (usage[0].c > 0) {
      throw new AppError(
        ERROR_CODES.RESOURCE_IN_USE,
        'This value is used by one or more variants.',
        { status: 409, details: { variantCount: usage[0].c } },
      );
    }

    const { rowCount } = await query(
      `DELETE FROM product_attribute_values WHERE id = $1 AND attribute_id = $2`,
      [valueId, id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await logActivity({
      entityType: 'attribute',
      entityId: id,
      action: 'attribute.value_removed',
      performedBy: req.user.id,
      oldValue: { valueId },
    });
    return ok(res, { id, valueId, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function reorderValues(req, res, next) {
  try {
    const body = reorderValuesSchema.parse(req.body || {});
    const { id } = req.params;

    await withTransaction(async (client) => {
      for (const v of body.values) {
        await client.query(
          `UPDATE product_attribute_values SET sort_order = $1
            WHERE id = $2 AND attribute_id = $3`,
          [v.sortOrder, v.id, id],
        );
      }
    });

    const values = await loadValues(id);
    return ok(res, values);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, addValue, removeValue, reorderValues };
