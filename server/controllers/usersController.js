const bcrypt = require('bcrypt');
const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const createSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, numbers, dot, underscore, hyphen'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  roleId: z.string().uuid(),
  employeeId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(6).max(200).optional(),
  roleId: z.string().uuid().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const USER_SELECT = `
  SELECT u.id, u.username, u.is_active, u.created_at, u.updated_at,
         u.role_id, r.name AS role_name,
         u.employee_id, e.name AS employee_name, e.email AS employee_email,
         (
           SELECT MAX(s.last_activity_at)
             FROM user_sessions s
            WHERE s.user_id = u.id AND s.logout_at IS NULL
         ) AS last_active_at,
         EXISTS (
           SELECT 1 FROM user_sessions s
            WHERE s.user_id = u.id AND s.logout_at IS NULL
         ) AS is_online
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN employees e ON e.id = u.employee_id
`;

function shape(row) {
  return {
    id: row.id,
    username: row.username,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role_name ? { id: row.role_id, name: row.role_name } : null,
    employee: row.employee_id
      ? { id: row.employee_id, name: row.employee_name, email: row.employee_email }
      : null,
    isOnline: row.is_online,
    lastActiveAt: row.last_active_at,
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
      where.push(`(u.username ILIKE $${params.length} OR e.name ILIKE $${params.length})`);
    }
    if (req.query.isActive === 'true') where.push('u.is_active = true');
    if (req.query.isActive === 'false') where.push('u.is_active = false');

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM users u
                        LEFT JOIN employees e ON e.id = u.employee_id
                       ${whereSql}`;
    const { rows: countRows } = await query(countSql, params);

    params.push(limit, offset);
    const listSql = `${USER_SELECT} ${whereSql}
                     ORDER BY u.created_at DESC
                     LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await query(listSql, params);

    return ok(res, rows.map(shape), {
      page,
      limit,
      total: countRows[0].total,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${USER_SELECT} WHERE u.id = $1`, [req.params.id]);
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

    const exists = await query('SELECT id FROM users WHERE username = $1', [body.username]);
    if (exists.rows.length) {
      throw new AppError(ERROR_CODES.USERNAME_TAKEN, undefined, { status: 409 });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hash = await bcrypt.hash(body.password, rounds);

    const { rows } = await query(
      `INSERT INTO users (username, password_hash, role_id, employee_id, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [body.username, hash, body.roleId, body.employeeId || null, body.isActive ?? true],
    );

    // Phase 16: seed default notification preferences for the new user.
    try {
      await query(
        `INSERT INTO notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [rows[0].id],
      );
    } catch (_e) { /* best-effort */ }

    await logActivity({
      entityType: 'user',
      entityId: rows[0].id,
      action: 'user.created',
      performedBy: req.user.id,
      newValue: { username: body.username, roleId: body.roleId, employeeId: body.employeeId },
    });

    try {
      const notificationService = require('../services/notificationService');
      await notificationService.notifyRoles(['Admin'], {
        type: 'system.new_user_created',
        category: 'system',
        severity: 'info',
        title: `New user created: ${body.username}`,
        message: `Account provisioned by ${req.user.username}.`,
        referenceType: 'user',
        referenceId: rows[0].id,
        actionUrl: `/users`,
        createdBy: req.user.id,
        skipForUserId: req.user.id,
      });
    } catch (_e) { /* best-effort */ }

    const { rows: full } = await query(`${USER_SELECT} WHERE u.id = $1`, [rows[0].id]);
    return created(res, shape(full[0]));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { id } = req.params;

    const { rows: existing } = await query(
      'SELECT id, username, role_id, employee_id, is_active FROM users WHERE id = $1',
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    if (body.username && body.username !== existing[0].username) {
      const dup = await query(
        'SELECT id FROM users WHERE username = $1 AND id <> $2',
        [body.username, id],
      );
      if (dup.rows.length) {
        throw new AppError(ERROR_CODES.USERNAME_TAKEN, undefined, { status: 409 });
      }
    }

    const sets = [];
    const params = [];
    function add(col, val) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
    if (body.username !== undefined) add('username', body.username);
    if (body.roleId !== undefined) add('role_id', body.roleId);
    if (body.employeeId !== undefined) add('employee_id', body.employeeId);
    if (body.isActive !== undefined) add('is_active', body.isActive);
    if (body.password) {
      const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
      const hash = await bcrypt.hash(body.password, rounds);
      add('password_hash', hash);
    }
    if (!sets.length) {
      return ok(res, existing[0]);
    }
    sets.push('updated_at = NOW()');
    params.push(id);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    if (body.roleId && body.roleId !== existing[0].role_id) {
      await logActivity({
        entityType: 'user',
        entityId: id,
        action: 'user.role_changed',
        performedBy: req.user.id,
        oldValue: { roleId: existing[0].role_id },
        newValue: { roleId: body.roleId },
      });
    }
    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.updated',
      performedBy: req.user.id,
      newValue: { ...body, password: body.password ? '***' : undefined },
    });

    const { rows } = await query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    return ok(res, shape(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function softDelete(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'You cannot deactivate your own account.', {
        status: 400,
      });
    }

    const { rowCount } = await query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    // Also kill any active sessions for the deactivated user.
    await query(
      `UPDATE user_sessions
          SET logout_at = NOW(), logout_type = 'deactivated', status = 'offline'
        WHERE user_id = $1 AND logout_at IS NULL`,
      [id],
    );

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.deactivated',
      performedBy: req.user.id,
    });

    return ok(res, { id, isActive: false });
  } catch (err) {
    next(err);
  }
}

async function forceLogout(req, res, next) {
  try {
    const { id } = req.params;

    const { rows: sessions } = await query(
      `SELECT id, pc_identifier FROM user_sessions
        WHERE user_id = $1 AND logout_at IS NULL`,
      [id],
    );

    if (!sessions.length) {
      return ok(res, { id, sessionsClosed: 0 });
    }

    await query(
      `UPDATE user_sessions
          SET logout_at = NOW(),
              logout_type = 'forced',
              status = 'offline'
        WHERE user_id = $1 AND logout_at IS NULL`,
      [id],
    );

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.force_logout',
      performedBy: req.user.id,
      notes: `Force-logged ${sessions.length} session(s)`,
    });

    const io = req.app.get('io');
    if (io) {
      for (const s of sessions) {
        io.to(`session:${s.id}`).emit('force_logout', {
          reason: 'Forced by administrator',
          by: req.user.username,
        });
        io.emit('user_offline', {
          userId: id,
          pcIdentifier: s.pc_identifier,
          logoutType: 'forced',
        });
      }
    }

    return ok(res, { id, sessionsClosed: sessions.length });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Per-user permission overrides
// ---------------------------------------------------------------------------

async function getPermissions(req, res, next) {
  try {
    const { id } = req.params;

    // User + role info
    const { rows: userRows } = await query(
      `SELECT u.id, u.username, r.id AS role_id, r.name AS role_name
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [id],
    );
    if (!userRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const u = userRows[0];

    // All permissions in the system (for the full matrix)
    const { rows: allPerms } = await query(
      `SELECT id, key, label, module FROM permissions ORDER BY module, key`,
    );

    // Role's permissions
    const { rows: rolePermRows } = await query(
      `SELECT p.key FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1`,
      [u.role_id],
    );
    const roleKeys = new Set(rolePermRows.map((r) => r.key));

    // User-level overrides
    const { rows: overrideRows } = await query(
      `SELECT p.key, up.granted
         FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = $1`,
      [id],
    );
    const userOverrides = Object.fromEntries(
      overrideRows.map((r) => [r.key, r.granted]),
    );

    // Effective set
    const effective = new Set(roleKeys);
    for (const [key, granted] of Object.entries(userOverrides)) {
      if (granted) effective.add(key);
      else effective.delete(key);
    }

    return ok(res, {
      userId: u.id,
      username: u.username,
      roleId: u.role_id,
      roleName: u.role_name,
      rolePermissionKeys: Array.from(roleKeys),
      userOverrides,
      effectiveKeys: Array.from(effective),
      allPermissions: allPerms,
    });
  } catch (err) {
    next(err);
  }
}

const setPermissionsSchema = z.object({
  effectiveKeys: z.array(z.string()).default([]),
});

async function setPermissions(req, res, next) {
  try {
    const { id } = req.params;
    const body = setPermissionsSchema.parse(req.body || {});

    // Load role permissions to compute the delta
    const { rows: userRows } = await query(
      `SELECT u.id, r.id AS role_id FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id],
    );
    if (!userRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const roleId = userRows[0].role_id;

    const { rows: rolePermRows } = await query(
      `SELECT p.id AS perm_id, p.key
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1`,
      [roleId],
    );
    const roleKeys = new Set(rolePermRows.map((r) => r.key));
    const rolePermMap = Object.fromEntries(rolePermRows.map((r) => [r.key, r.perm_id]));

    // Load all permissions by key → id
    const { rows: allPerms } = await query(`SELECT id, key FROM permissions`);
    const permIdMap = Object.fromEntries(allPerms.map((p) => [p.key, p.id]));

    const desiredKeys = new Set(body.effectiveKeys);

    // Build the overrides: only store rows that DIFFER from the role default.
    // granted=true  → desired but role doesn't have it (extra grant)
    // granted=false → not desired but role has it   (explicit deny)
    const overrides = [];
    for (const key of desiredKeys) {
      if (!roleKeys.has(key)) {
        const permId = permIdMap[key];
        if (permId) overrides.push({ permId, granted: true });
      }
    }
    for (const key of roleKeys) {
      if (!desiredKeys.has(key)) {
        const permId = rolePermMap[key] || permIdMap[key];
        if (permId) overrides.push({ permId, granted: false });
      }
    }

    // Replace all user_permissions rows atomically
    await withTransaction(async (client) => {
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
      for (const { permId, granted } of overrides) {
        await client.query(
          `INSERT INTO user_permissions (user_id, permission_id, granted)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = EXCLUDED.granted`,
          [id, permId, granted],
        );
      }
    });

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.permissions_updated',
      performedBy: req.user.id,
      newValue: { overridesCount: overrides.length },
    });

    return ok(res, { updated: true, overridesCount: overrides.length });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, softDelete, forceLogout, getPermissions, setPermissions };
