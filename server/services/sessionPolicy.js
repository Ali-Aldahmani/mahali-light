const { query } = require('../db/postgres');
const presenceService = require('./presenceService');
const attendanceService = require('./attendanceService');

// How long a signed-in session lasts (authentication audit AUTH-02, AUTH-03).
//
// - Idle: no keyboard, mouse or touch input on the screen for
//   IDLE_SIGNOUT_MINUTES (default 15). Heartbeats say whether there was input
//   (presence audit F08), and only input moves last_activity_at, so an
//   unattended till that is still connected is signed out. 0 turns it off.
// - Disconnected: the screen has been gone (no heartbeat at all) for 30
//   minutes, e.g. a closed browser.
// - Maximum length: SESSION_MAX_HOURS (default 12, about one shift) after
//   sign-in, however busy the till is. Refreshing a token doesn't extend it.
const IDLE_SIGNOUT_MINUTES = Number(process.env.IDLE_SIGNOUT_MINUTES ?? 15);
const DISCONNECTED_SIGNOUT_MINUTES = 30;
const SESSION_MAX_HOURS = Number(process.env.SESSION_MAX_HOURS || 12);

const REASONS = {
  idle: 'Signed out after inactivity',
  timeout: 'Signed out after the screen was closed',
  expired: 'Your session reached its maximum length. Please sign in again.',
};

// Close every session past one of the limits, cut its sockets, close the
// attendance record when it was the employee's last session, and tell the
// presence viewers. The UPDATE re-checks the limits itself, so a heartbeat
// landing after a session was looked at can't be undone by a stale read.
async function sweepSessions(io, {
  idleMinutes = IDLE_SIGNOUT_MINUTES,
  disconnectedMinutes = DISCONNECTED_SIGNOUT_MINUTES,
} = {}) {
  const { rows } = await query(
    `UPDATE user_sessions s
        SET logout_at = NOW(),
            logout_type = CASE
              WHEN s.absolute_expires_at <= NOW() THEN 'expired'
              WHEN COALESCE(s.last_seen_at, s.last_activity_at) < NOW() - make_interval(mins => $2) THEN 'timeout'
              ELSE 'idle' END,
            status = 'offline'
       FROM users u
      WHERE u.id = s.user_id
        AND s.logout_at IS NULL
        AND (
          s.absolute_expires_at <= NOW()
          OR COALESCE(s.last_seen_at, s.last_activity_at) < NOW() - make_interval(mins => $2)
          OR ($1 > 0 AND s.last_activity_at < NOW() - make_interval(mins => $1))
        )
      RETURNING s.id, s.user_id, s.logout_type, u.employee_id`,
    [idleMinutes, disconnectedMinutes],
  );
  for (const type of Object.keys(REASONS)) {
    presenceService.disconnectSessions(io, rows.filter((r) => r.logout_type === type).map((r) => r.id), {
      reason: REASONS[type],
    });
  }
  for (const r of rows) {
    if (!r.employee_id) continue;
    // Only close attendance if this was the last live session for the
    // employee — multi-PC users stay checked in.
    const { rows: liveRows } = await query(
      `SELECT 1 FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.employee_id = $1 AND s.logout_at IS NULL
        LIMIT 1`,
      [r.employee_id],
    );
    if (!liveRows.length) {
      await attendanceService.checkOutSafe({
        employeeId: r.employee_id, method: 'timeout', userId: r.user_id, io,
      });
    }
  }
  for (const userId of new Set(rows.map((r) => r.user_id))) {
    await presenceService.publishUserPresence(io, userId);
  }
  return rows;
}

module.exports = {
  IDLE_SIGNOUT_MINUTES, DISCONNECTED_SIGNOUT_MINUTES, SESSION_MAX_HOURS, sweepSessions,
};
