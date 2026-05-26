const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const createSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  requiresSerial: z.boolean().optional().default(false),
  icon: z.string().max(50).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial();

const attributesSchema = z.object({
  attributes: z
    .array(
      z.object({
        attributeId: z.string().uuid(),
        isRequired: z.boolean().optional().default(false),
        displayOrder: z.number().int().optional().default(0),
      }),
    )
    .default([]),
});

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    description: row.description,
    requiresSerial: row.requires_serial,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: row.product_count !== undefined ? Number(row.product_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Build a nested tree from a flat list. Inactive categories are excluded by
// default at the SQL layer.
function buildTree(rows) {
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.id, { ...shape(r), children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr) => {
    arr.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

const LIST_SQL = `
  SELECT c.*,
         (SELECT COUNT(*)::int FROM products p
            WHERE p.category_id = c.id AND p.is_active = true) AS product_count
    FROM product_categories c
   WHERE c.is_active = true
`;

async function tree(_req, res, next) {
  try {
    const { rows } = await query(LIST_SQL);
    return ok(res, buildTree(rows));
  } catch (err) {
    next(err);
  }
}

async function flat(_req, res, next) {
  try {
    const { rows } = await query(`${LIST_SQL} ORDER BY c.sort_order, c.name`);
    // Add a `path` field for nicer dropdowns ("Lighting > LED Bulbs").
    const byId = new Map(rows.map((r) => [r.id, r]));
    const list = rows.map((r) => {
      const parts = [];
      let cur = r;
      const visited = new Set();
      while (cur && !visited.has(cur.id)) {
        parts.unshift(cur.name);
        visited.add(cur.id);
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      const shaped = shape(r);
      shaped.path = parts.join(' > ');
      shaped.depth = parts.length - 1;
      return shaped;
    });
    return ok(res, list);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${LIST_SQL} AND c.id = $1`, [req.params.id]);
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
    if (body.parentId) {
      const { rows } = await query(`SELECT id FROM product_categories WHERE id = $1`, [
        body.parentId,
      ]);
      if (!rows.length) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Parent category not found.', {
          status: 400,
          details: [{ path: 'parentId', message: 'Unknown parent' }],
        });
      }
    }

    const { rows } = await query(
      `INSERT INTO product_categories
         (name, parent_id, description, requires_serial, icon, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        body.name,
        body.parentId || null,
        body.description || null,
        body.requiresSerial || false,
        body.icon || null,
        body.sortOrder || 0,
        body.isActive ?? true,
      ],
    );
    await logActivity({
      entityType: 'category',
      entityId: rows[0].id,
      action: 'category.created',
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
    const { rows: existing } = await query(
      `SELECT * FROM product_categories WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    if (body.parentId) {
      if (body.parentId === id) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'A category cannot be its own parent.',
          { status: 400 },
        );
      }
      // Also prevent circular descendants.
      const { rows: descendants } = await query(
        `WITH RECURSIVE d AS (
           SELECT id FROM product_categories WHERE parent_id = $1
           UNION ALL
           SELECT c.id FROM product_categories c JOIN d ON c.parent_id = d.id
         )
         SELECT id FROM d`,
        [id],
      );
      if (descendants.some((d) => d.id === body.parentId)) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Cannot move a category under one of its descendants.',
          { status: 400 },
        );
      }
    }

    const map = {
      name: 'name',
      parentId: 'parent_id',
      description: 'description',
      requiresSerial: 'requires_serial',
      icon: 'icon',
      sortOrder: 'sort_order',
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
    await query(
      `UPDATE product_categories SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    await logActivity({
      entityType: 'category',
      entityId: id,
      action: 'category.updated',
      performedBy: req.user.id,
      oldValue: shape(existing[0]),
      newValue: body,
    });

    const { rows } = await query(`${LIST_SQL} AND c.id = $1`, [id]);
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, is_active FROM product_categories WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const { rows: productCount } = await query(
      `SELECT COUNT(*)::int AS c FROM products
        WHERE category_id = $1 AND is_active = true`,
      [id],
    );
    if (productCount[0].c > 0) {
      throw new AppError(
        ERROR_CODES.RESOURCE_IN_USE,
        `Cannot delete category with ${productCount[0].c} active product${
          productCount[0].c === 1 ? '' : 's'
        }.`,
        { status: 409, details: { productCount: productCount[0].c } },
      );
    }

    const { rows: childCount } = await query(
      `SELECT COUNT(*)::int AS c FROM product_categories
        WHERE parent_id = $1 AND is_active = true`,
      [id],
    );
    if (childCount[0].c > 0) {
      throw new AppError(
        ERROR_CODES.RESOURCE_IN_USE,
        `Cannot delete category with ${childCount[0].c} subcategor${
          childCount[0].c === 1 ? 'y' : 'ies'
        }.`,
        { status: 409, details: { subcategoryCount: childCount[0].c } },
      );
    }

    await query(
      `UPDATE product_categories SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    await logActivity({
      entityType: 'category',
      entityId: id,
      action: 'category.deleted',
      performedBy: req.user.id,
    });

    return ok(res, { id, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function listAttributes(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT ca.attribute_id, ca.is_required, ca.display_order,
              a.name, a.unit
         FROM category_attributes ca
         JOIN product_attributes a ON a.id = ca.attribute_id
        WHERE ca.category_id = $1
        ORDER BY ca.display_order ASC, a.name ASC`,
      [id],
    );

    const data = await Promise.all(
      rows.map(async (r) => {
        const { rows: values } = await query(
          `SELECT id, value, sort_order FROM product_attribute_values
            WHERE attribute_id = $1 ORDER BY sort_order, value`,
          [r.attribute_id],
        );
        return {
          attributeId: r.attribute_id,
          name: r.name,
          unit: r.unit,
          isRequired: r.is_required,
          displayOrder: r.display_order,
          values: values.map((v) => ({
            id: v.id,
            value: v.value,
            sortOrder: v.sort_order,
          })),
        };
      }),
    );

    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function setAttributes(req, res, next) {
  try {
    const body = attributesSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: cat } = await query(
      `SELECT id FROM product_categories WHERE id = $1`,
      [id],
    );
    if (!cat.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM category_attributes WHERE category_id = $1', [id]);
      for (const a of body.attributes) {
        await client.query(
          `INSERT INTO category_attributes
             (category_id, attribute_id, is_required, display_order)
           VALUES ($1,$2,$3,$4)`,
          [id, a.attributeId, !!a.isRequired, a.displayOrder || 0],
        );
      }
    });

    await logActivity({
      entityType: 'category',
      entityId: id,
      action: 'category.attributes_updated',
      performedBy: req.user.id,
      newValue: body.attributes,
    });

    return ok(res, { id, attributes: body.attributes });
  } catch (err) {
    next(err);
  }
}

module.exports = { tree, flat, getOne, create, update, remove, listAttributes, setAttributes };
