const express = require('express');
const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('user.edit'), async (req, res, next) => {
  try {
    // DISTINCT ON (s.user_id) collapses multiple open sessions for the same
    // user (e.g. two browser tabs, both logged in independently) down to
    // one row — their most recently active session — so the same person
    // never appears twice in the list. status <> 'offline' excludes
    // sessions whose socket has disconnected but hasn't hit an explicit
    // logout yet (see server/socket/index.js), so "online" here tracks the
    // live connection, not just "still holds a valid token."
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
          ORDER BY s.user_id, s.last_activity_at DESC
       ) t
       ORDER BY t.last_activity_at DESC`,
    );

    const data = rows.map((r) => ({
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
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
