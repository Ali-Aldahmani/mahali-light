const { query } = require('../db/postgres');

// Who is online, and the one place sessions end.
//
// Presence is per user: a user is online while any of their sessions is
// open and not offline. Every change is published as a `presence_update`
// carrying that user's whole current entry (or null when they are gone),
// so a viewer never has to piece the state together from separate
// online / offline / idle events, and a late event cannot leave a stale row.
//
// Only users allowed to see presence receive it — the same rule as the
// REST snapshot (GET /presence) and the header widget.

const PRESENCE_VIEW_PERMISSIONS = ['user.edit', 'user.force_logout'];
const OBSERVERS_ROOM = 'presence:observers';

function canViewPresence(permissions) {
  const owned = new Set(permissions || []);
  return owned.has('*') || PRESENCE_VIEW_PERMISSIONS.some((k) => owned.has(k));
}

// One row per user: their most recently active open, connected session.
async function listPresence({ userId = null } = {}) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (s.user_id)
              s.id AS session_id, s.user_id, s.pc_identifier, s.ip_address,
              s.login_at, s.last_activity_at, s.status,
              u.username, r.name AS role_name,
              e.name AS employee_name
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE s.logout_at IS NULL
          AND s.status <> 'offline'
          AND u.is_active
          AND ($1::uuid IS NULL OR s.user_id = $1)
        ORDER BY s.user_id, s.last_activity_at DESC
     ) t
     ORDER BY t.last_activity_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    userId: r.user_id,
    username: r.username,
    role: r.role_name,
    employeeName: r.employee_name,
    pcIdentifier: r.pc_identifier,
    ipAddress: r.ip_address,
    loginAt: r.login_at,
    lastActivityAt: r.last_activity_at,
    status: r.status,
  }));
}

// Recompute one user's presence and send it to the observers.
async function publishUserPresence(io, userId) {
  if (!io || !userId) return;
  try {
    const [entry] = await listPresence({ userId });
    io.to(OBSERVERS_ROOM).emit('presence_update', { userId, entry: entry || null });
  } catch (_err) {
    // best-effort: viewers re-read the snapshot when they reconnect
  }
}

// Cut the live connections of sessions that have just been closed. A client
// that ignores `force_logout` is still disconnected, and its handshake is
// refused from now on because the session row is closed.
function disconnectSessions(io, sessionIds, { reason = null } = {}) {
  if (!io) return;
  for (const id of sessionIds) {
    if (reason) io.to(`session:${id}`).emit('force_logout', { reason });
    io.in(`session:${id}`).disconnectSockets(true);
  }
}

/**
 * Close a user's open sessions and disconnect them.
 * @param io
 * @param opts { userId, logoutType, exceptSessionId?, reason? }
 *   reason — shown to the signed-out user; omit for their own logout.
 * @returns the closed sessions ({ id, pc_identifier })
 */
async function revokeUserSessions(io, { userId, logoutType, exceptSessionId = null, reason = null }) {
  const { rows } = await query(
    `UPDATE user_sessions
        SET logout_at = NOW(), logout_type = $2, status = 'offline'
      WHERE user_id = $1 AND logout_at IS NULL
        AND ($3::uuid IS NULL OR id <> $3)
      RETURNING id, pc_identifier`,
    [userId, logoutType, exceptSessionId],
  );
  disconnectSessions(io, rows.map((r) => r.id), { reason });
  await publishUserPresence(io, userId);
  return rows;
}

// After a role or permission change: drop the user's sockets so they
// reconnect with fresh rooms (permission rooms, presence observers). The session
// stays open; the client reconnects on its own.
function refreshUserSockets(io, userId) {
  if (io && userId) io.in(`user:${userId}`).disconnectSockets(true);
}

function refreshRoleSockets(io, roleName) {
  if (io && roleName) io.in(`role:${roleName}`).disconnectSockets(true);
}

module.exports = {
  PRESENCE_VIEW_PERMISSIONS,
  OBSERVERS_ROOM,
  canViewPresence,
  listPresence,
  publishUserPresence,
  disconnectSessions,
  revokeUserSessions,
  refreshUserSockets,
  refreshRoleSockets,
};
