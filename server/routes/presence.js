const express = require('express');
const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('user.edit'), async (req, res, next) => {
  try {
    // DISTINCT ON (user_id, pc_identifier) as a defensive read-time dedupe —
    // only one "online" entry per user+PC should ever be shown, keeping the
    // most recently active one. The write side (login) also closes out any
    // prior open session for the same user+PC, but this guards against any
    // other path that could otherwise leave a stale duplicate row.
    //
    // status <> 'offline': socket/index.js's disconnect handler sets status
    // to 'offline' WITHOUT setting logout_at (a dropped connection isn't a
    // logout — the idle-timeout sweeper closes it out for real after 30 min
    // of inactivity). Without this filter, a user whose app crashed or lost
    // network would still show as "Online" here even though every already-
    // connected client was correctly told via the user_offline broadcast to
    // remove them — this keeps a fresh page load consistent with that.
    const { rows } = await query(
      `SELECT * FROM (
         SELECT DISTINCT ON (s.user_id, s.pc_identifier)
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
          ORDER BY s.user_id, s.pc_identifier, s.last_activity_at DESC
       ) deduped
       ORDER BY last_activity_at DESC`,
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
