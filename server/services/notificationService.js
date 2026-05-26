const { query } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');

// =======================================================================
// Notification categories ↔ preference flags. Update both ends together.
// =======================================================================
const CATEGORY_PREF = {
  stock: 'stock_alerts',
  invoice: 'invoice_alerts',
  return: 'return_alerts',
  warranty: 'warranty_alerts',
  attendance: 'attendance_alerts',
  bill: 'bill_alerts',
  finance: 'finance_alerts',
  system: 'system_alerts',
  approval: 'approval_alerts',
  report: 'report_alerts',
};

const SEVERITY_PREF = {
  info: 'show_info',
  warning: 'show_warning',
  error: 'show_error',
  critical: 'show_critical',
};

const DEFAULT_PREFERENCES = Object.fromEntries([
  ...Object.values(CATEGORY_PREF).map((k) => [k, true]),
  ...Object.values(SEVERITY_PREF).map((k) => [k, true]),
  ['sound_enabled', true],
]);

// Module-level handle so background services (cron jobs) can dispatch
// without threading `io` through every call site.
let ioInstance = null;
function setIoInstance(io) {
  ioInstance = io;
}
function getIoInstance() {
  return ioInstance;
}

// =======================================================================
// Preference lookups (cached per request via Map, refresh on update)
// =======================================================================
async function loadPreferences(userId) {
  const { rows } = await query(
    `SELECT * FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  if (rows[0]) return rows[0];
  // Create defaults on first read.
  const { rows: created } = await query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId],
  );
  return created[0];
}

function preferenceAllows(prefs, notification) {
  if (!prefs) return true; // be permissive when prefs row is missing
  const catFlag = CATEGORY_PREF[notification.category];
  const sevFlag = SEVERITY_PREF[notification.severity || 'info'];
  if (catFlag && prefs[catFlag] === false) return false;
  if (sevFlag && prefs[sevFlag] === false) return false;
  // Critical notifications always pass — they cannot be muted by category.
  if (notification.severity === 'critical') return true;
  return true;
}

// =======================================================================
// Target resolution
// =======================================================================
async function resolveTargets({ targetUserIds, targetRoles, isBroadcast }) {
  if (Array.isArray(targetUserIds) && targetUserIds.length) {
    const { rows } = await query(
      `SELECT u.id, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = ANY($1::uuid[]) AND u.is_active = true`,
      [targetUserIds],
    );
    return rows;
  }
  if (Array.isArray(targetRoles) && targetRoles.length) {
    const { rows } = await query(
      `SELECT u.id, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE r.name = ANY($1::text[]) AND u.is_active = true`,
      [targetRoles],
    );
    return rows;
  }
  if (isBroadcast) {
    const { rows } = await query(
      `SELECT u.id, r.name AS role_name FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = true`,
    );
    return rows;
  }
  return [];
}

// =======================================================================
// Batch/dedupe: when the same dedupe_key fires within 5 minutes we merge
// into the existing row (bump message + created_at). Lets services like
// stock alerts fire freely without spamming.
// =======================================================================
async function findRecentByDedupe(dedupeKey) {
  if (!dedupeKey) return null;
  const { rows } = await query(
    `SELECT * FROM notifications
      WHERE dedupe_key = $1
        AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [dedupeKey],
  );
  return rows[0] || null;
}

// =======================================================================
// Persist + dispatch
// =======================================================================
async function createNotification(params) {
  const {
    type,
    title,
    message,
    severity = 'info',
    category,
    referenceType = null,
    referenceId = null,
    actionUrl = null,
    targetRoles = null,
    targetUserIds = null,
    isBroadcast = false,
    createdBy = null,
    dedupeKey = null,
    skipForUserId = null,
    // Skip dispatching to this user (e.g. don't notify the actor about
    // their own action).
  } = params || {};

  if (!type || !title || !category) {
    throw new Error('notificationService.createNotification: type, title and category are required');
  }

  let row;
  const recent = await findRecentByDedupe(dedupeKey);
  if (recent) {
    // Batch: rewrite the latest row in place so the panel shows one entry.
    const upd = await query(
      `UPDATE notifications
         SET title = $2,
             message = $3,
             severity = COALESCE($4, severity),
             created_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [recent.id, title, message, severity],
    );
    row = upd.rows[0];
    // Clear previous reads so it pops as unread again.
    await query(
      `DELETE FROM notification_reads WHERE notification_id = $1`,
      [recent.id],
    );
  } else {
    const insert = await query(
      `INSERT INTO notifications
         (type, title, message, severity, category, reference_type, reference_id,
          action_url, target_roles, target_user_ids, is_broadcast, dedupe_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        type,
        title,
        message,
        severity,
        category,
        referenceType,
        referenceId,
        actionUrl,
        targetRoles ? JSON.stringify(targetRoles) : null,
        targetUserIds ? JSON.stringify(targetUserIds) : null,
        Boolean(isBroadcast),
        dedupeKey,
        createdBy,
      ],
    );
    row = insert.rows[0];
  }

  const targets = await resolveTargets({
    targetUserIds,
    targetRoles,
    isBroadcast,
  });

  const payload = shape(row);

  if (ioInstance) {
    for (const target of targets) {
      if (skipForUserId && target.id === skipForUserId) continue;
      try {
        // Honour the user's preferences — quietly skip muted categories.
        const prefs = await loadPreferences(target.id);
        if (!preferenceAllows(prefs, payload)) continue;
        const unreadCount = await getUnreadCount(target.id);
        ioInstance
          .to(`user:${target.id}`)
          .emit('notification_new', { notification: payload, unread_count: unreadCount });
      } catch (_err) {
        // best-effort per recipient
      }
    }
  }

  return payload;
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity || 'info',
    category: row.category,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    action_url: row.action_url,
    target_roles: row.target_roles || null,
    target_user_ids: row.target_user_ids || null,
    is_broadcast: row.is_broadcast === true,
    created_by: row.created_by,
    created_at: row.created_at,
    is_read: row.is_read === true,
    read_at: row.read_at || null,
    dismissed: row.dismissed === true,
    dismissed_at: row.dismissed_at || null,
  };
}

// Reusable WHERE fragment — restricts the notifications visible to one user.
function userScopeSql(userId, role) {
  // Postgres parameters for [user_id, role].
  return `(
    n.is_broadcast = true
    OR (n.target_user_ids IS NOT NULL AND n.target_user_ids ? $1::text)
    OR (n.target_roles IS NOT NULL AND $2::text IS NOT NULL AND n.target_roles ? $2::text)
    OR n.created_by = $1::uuid
  )`;
}

async function listForUser({
  userId,
  role,
  page = 1,
  limit = 30,
  category = null,
  severity = null,
  unreadOnly = false,
}) {
  const offset = Math.max(0, (page - 1) * limit);
  const where = [userScopeSql(userId, role)];
  const params = [userId, role || null];
  if (category) {
    params.push(category);
    where.push(`n.category = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    where.push(`n.severity = $${params.length}`);
  }
  if (unreadOnly) {
    where.push(`nr.id IS NULL`);
  }
  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT n.*,
            (nr.id IS NOT NULL)        AS is_read,
            nr.read_at                 AS read_at,
            COALESCE(nr.dismissed, false) AS dismissed,
            nr.dismissed_at            AS dismissed_at
       FROM notifications n
       LEFT JOIN notification_reads nr
              ON nr.notification_id = n.id AND nr.user_id = $1
      WHERE ${where.join(' AND ')}
      ORDER BY n.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(shape);
}

async function getUnreadCount(userId, role = null) {
  let actualRole = role;
  if (!actualRole) {
    const { rows } = await query(
      `SELECT r.name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [userId],
    );
    actualRole = rows[0]?.name || null;
  }
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM notifications n
       LEFT JOIN notification_reads nr
              ON nr.notification_id = n.id AND nr.user_id = $1
      WHERE ${userScopeSql(userId, actualRole)}
        AND nr.id IS NULL`,
    [userId, actualRole],
  );
  return rows[0]?.count || 0;
}

async function markAsRead({ notificationId, userId }) {
  await query(
    `INSERT INTO notification_reads (notification_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
    [notificationId, userId],
  );
  const count = await getUnreadCount(userId);
  if (ioInstance) {
    ioInstance.to(`user:${userId}`).emit('notification_read_ack', {
      notification_id: notificationId,
      unread_count: count,
    });
  }
  return count;
}

async function markAllAsRead({ userId, role }) {
  const { rows } = await query(
    `SELECT n.id
       FROM notifications n
       LEFT JOIN notification_reads nr
              ON nr.notification_id = n.id AND nr.user_id = $1
      WHERE ${userScopeSql(userId, role)} AND nr.id IS NULL`,
    [userId, role || null],
  );
  for (const r of rows) {
    await query(
      `INSERT INTO notification_reads (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [r.id, userId],
    );
  }
  if (ioInstance) {
    ioInstance.to(`user:${userId}`).emit('notification_read_ack', { unread_count: 0 });
  }
  return rows.length;
}

async function dismiss({ notificationId, userId, isAdmin = false }) {
  // Critical notifications can only be dismissed by admins. Other roles see
  // them stay until resolved.
  const { rows } = await query(
    `SELECT severity FROM notifications WHERE id = $1`,
    [notificationId],
  );
  const severity = rows[0]?.severity || 'info';
  if (severity === 'critical' && !isAdmin) {
    const e = new Error('Critical notifications cannot be dismissed by non-admin users.');
    e.code = 'CANNOT_DISMISS_CRITICAL';
    throw e;
  }
  await query(
    `INSERT INTO notification_reads (notification_id, user_id, dismissed, dismissed_at)
     VALUES ($1, $2, true, NOW())
     ON CONFLICT (notification_id, user_id) DO UPDATE SET
       dismissed = true,
       dismissed_at = NOW(),
       read_at = EXCLUDED.read_at`,
    [notificationId, userId],
  );
  const count = await getUnreadCount(userId);
  if (ioInstance) {
    ioInstance.to(`user:${userId}`).emit('notification_read_ack', {
      notification_id: notificationId,
      unread_count: count,
      dismissed: true,
    });
  }
}

// =======================================================================
// Convenience helpers used by feature services so they don't repeat the
// shape of every call.
// =======================================================================
async function notifyRoles(roles, params) {
  return createNotification({ ...params, targetRoles: roles });
}

async function notifyUser(userId, params) {
  return createNotification({ ...params, targetUserIds: [userId] });
}

async function notifyManagersAndAdmins(params) {
  return notifyRoles(['Admin', 'Manager'], params);
}

async function broadcast(params) {
  return createNotification({ ...params, isBroadcast: true });
}

// =======================================================================
// Preferences API
// =======================================================================
const ALL_FLAGS = [
  ...Object.values(CATEGORY_PREF),
  ...Object.values(SEVERITY_PREF),
  'sound_enabled',
];

async function getPreferences(userId) {
  return loadPreferences(userId);
}

async function updatePreferences(userId, patch) {
  const fields = [];
  const vals = [userId];
  for (const flag of ALL_FLAGS) {
    if (patch[flag] !== undefined) {
      vals.push(Boolean(patch[flag]));
      fields.push(`${flag} = $${vals.length}`);
    }
  }
  if (!fields.length) return loadPreferences(userId);
  vals.push(new Date());
  fields.push(`updated_at = $${vals.length}`);
  await query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const { rows } = await query(
    `UPDATE notification_preferences
        SET ${fields.join(', ')}
      WHERE user_id = $1
      RETURNING *`,
    vals,
  );
  await logActivity({
    entityType: 'notification',
    action: 'notification.preferences_updated',
    performedBy: userId,
    newValue: patch,
  });
  return rows[0];
}

module.exports = {
  setIoInstance,
  getIoInstance,
  createNotification,
  notifyRoles,
  notifyUser,
  notifyManagersAndAdmins,
  broadcast,
  listForUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  dismiss,
  getPreferences,
  updatePreferences,
  DEFAULT_PREFERENCES,
  ALL_FLAGS,
  CATEGORY_PREF,
  SEVERITY_PREF,
};
