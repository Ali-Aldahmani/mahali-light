const express = require('express');
const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('user.edit'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id AS session_id, s.user_id, s.pc_identifier, s.ip_address,
              s.login_at, s.last_activity_at, s.status,
              u.username, r.name AS role_name,
              e.name AS employee_name
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE s.logout_at IS NULL
        ORDER BY s.last_activity_at DESC`,
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
