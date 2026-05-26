const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const createSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional().nullable(),
  permissionKeys: z.array(z.string()).optional().default([]),
});

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).nullable().optional(),
});

const setPermsSchema = z.object({
  permissionKeys: z.array(z.string()).min(0),
});

async function loadRoleWithPermissions(roleId) {
  const { rows } = await query(
    `SELECT id, name, description, is_system, created_at FROM roles WHERE id = $1`,
    [roleId],
  );
  if (!rows.length) return null;
  const role = rows[0];

  const { rows: permRows } = await query(
    `SELECT p.key, p.label, p.module
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.module, p.key`,
    [roleId],
  );

  const { rows: userCount } = await query(
    `SELECT COUNT(*)::int AS c FROM users WHERE role_id = $1 AND is_active = true`,
    [roleId],
  );

  const modules = [...new Set(permRows.map((p) => p.module))];
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.is_system,
    createdAt: role.created_at,
    permissions: permRows,
    permissionKeys: permRows.map((p) => p.key),
    modules,
    userCount: userCount[0].c,
  };
}

async function list(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id FROM roles ORDER BY is_system DESC, name ASC`,
    );
    const result = await Promise.all(rows.map((r) => loadRoleWithPermissions(r.id)));
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const role = await loadRoleWithPermissions(req.params.id);
    if (!role) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, role);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    const role = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO roles (name, description, is_system)
         VALUES ($1,$2,false)
         RETURNING id`,
        [body.name, body.description || null],
      );
      const roleId = rows[0].id;

      if (body.permissionKeys.length) {
        const { rows: perms } = await client.query(
          `SELECT id, key FROM permissions WHERE key = ANY($1)`,
          [body.permissionKeys],
        );
        for (const p of perms) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`,
            [roleId, p.id],
          );
        }
      }
      return roleId;
    });

    await logActivity({
      entityType: 'role',
      entityId: role,
      action: 'role.created',
      performedBy: req.user.id,
      newValue: { name: body.name, permissionKeys: body.permissionKeys },
    });

    const result = await loadRoleWithPermissions(role);
    return created(res, result);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows } = await query(`SELECT id, is_system, name, description FROM roles WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].is_system && body.name && body.name !== rows[0].name) {
      throw new AppError(ERROR_CODES.ROLE_IS_SYSTEM, 'Cannot rename a system role.', { status: 400 });
    }

    const sets = [];
    const params = [];
    if (body.name !== undefined) {
      params.push(body.name);
      sets.push(`name = $${params.length}`);
    }
    if (body.description !== undefined) {
      params.push(body.description);
      sets.push(`description = $${params.length}`);
    }
    if (!sets.length) {
      const role = await loadRoleWithPermissions(id);
      return ok(res, role);
    }
    params.push(id);
    await query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    await logActivity({
      entityType: 'role',
      entityId: id,
      action: 'role.updated',
      performedBy: req.user.id,
      oldValue: { name: rows[0].name, description: rows[0].description },
      newValue: body,
    });

    const role = await loadRoleWithPermissions(id);
    return ok(res, role);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT is_system FROM roles WHERE id = $1', [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].is_system) {
      throw new AppError(ERROR_CODES.ROLE_IS_SYSTEM, undefined, { status: 400 });
    }

    const { rows: usage } = await query(
      'SELECT COUNT(*)::int AS c FROM users WHERE role_id = $1',
      [id],
    );
    if (usage[0].c > 0) {
      throw new AppError(
        ERROR_CODES.RESOURCE_IN_USE,
        'This role is still assigned to users.',
        { status: 409, details: { userCount: usage[0].c } },
      );
    }

    await query('DELETE FROM roles WHERE id = $1', [id]);
    await logActivity({
      entityType: 'role',
      entityId: id,
      action: 'role.deleted',
      performedBy: req.user.id,
    });
    return ok(res, { id, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function setPermissions(req, res, next) {
  try {
    const body = setPermsSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows } = await query('SELECT id, is_system FROM roles WHERE id = $1', [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    // System roles keep their name/locked status, but their permissions may
    // be tuned by an admin in this build.

    const before = await loadRoleWithPermissions(id);

    await withTransaction(async (client) => {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      if (body.permissionKeys.length) {
        const { rows: perms } = await client.query(
          'SELECT id FROM permissions WHERE key = ANY($1)',
          [body.permissionKeys],
        );
        for (const p of perms) {
          await client.query(
            'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)',
            [id, p.id],
          );
        }
      }
    });

    await logActivity({
      entityType: 'role',
      entityId: id,
      action: 'role.permissions_updated',
      performedBy: req.user.id,
      oldValue: { permissionKeys: before?.permissionKeys || [] },
      newValue: { permissionKeys: body.permissionKeys },
    });

    const role = await loadRoleWithPermissions(id);
    return ok(res, role);
  } catch (err) {
    next(err);
  }
}

async function listPermissions(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, key, label, module FROM permissions ORDER BY module, key`,
    );
    return ok(res, rows);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, remove, setPermissions, listPermissions };
