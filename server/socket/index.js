const { Server } = require('socket.io');
const { verifyToken } = require('../middleware/auth');
const { query } = require('../db/postgres');
const attendanceService = require('../services/attendanceService');

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const TIMEOUT_LOGOUT_MS = 30 * 60 * 1000;

function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // Authenticate the socket via JWT in handshake.auth.token (or query).
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        socket.handshake.query.token;
      if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

      const payload = verifyToken(token);

      const { rows } = await query(
        `SELECT s.id AS session_id, s.pc_identifier, u.username, r.name AS role_name
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN roles r ON r.id = u.role_id
          WHERE s.token = $1 AND s.logout_at IS NULL
          ORDER BY s.login_at DESC LIMIT 1`,
        [token],
      );
      if (!rows.length) return next(new Error('AUTH_SESSION_EXPIRED'));

      socket.data.userId = payload.sub;
      socket.data.username = rows[0].username;
      socket.data.role = rows[0].role_name;
      socket.data.sessionId = rows[0].session_id;
      socket.data.pcIdentifier = rows[0].pc_identifier;
      socket.data.token = token;

      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? 'AUTH_SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, username, role, pcIdentifier, sessionId, token } = socket.data;

    socket.join(`user:${userId}`);
    socket.join(`token:${token}`);
    // Role-based room used by stock alerts, adjustment requests, etc.
    if (role) socket.join(`role:${role}`);

    socket.emit('connected', { userId, username, role });
    socket.broadcast.emit('user_online', { userId, username, role, pcIdentifier });

    socket.on('heartbeat', async () => {
      try {
        await query(
          `UPDATE user_sessions SET last_activity_at = NOW(), status = 'online' WHERE id = $1`,
          [sessionId],
        );
      } catch (err) {
        // ignore; heartbeats are best-effort
      }
    });

    socket.on('disconnect', async () => {
      try {
        // Mark session offline but do NOT set logout_at — the user may still
        // be authenticated; explicit logout is required for that.
        await query(
          `UPDATE user_sessions SET status = 'offline' WHERE id = $1`,
          [sessionId],
        );
        io.emit('user_offline', { userId, pcIdentifier, logoutType: 'disconnect' });
      } catch (err) {
        // ignore
      }
    });
  });

  // Idle-timeout sweeper — sessions inactive past TIMEOUT_LOGOUT_MS get a
  // hard logout AND an attendance check-out with method='timeout'. This is
  // the safety net for users who close their app without signing out.
  setInterval(async () => {
    try {
      const cutoffMin = Math.floor(TIMEOUT_LOGOUT_MS / 60000);
      const { rows } = await query(
        `SELECT s.id, s.user_id, s.pc_identifier, u.employee_id
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.logout_at IS NULL
            AND s.last_activity_at < NOW() - ($1 || ' minutes')::interval`,
        [String(cutoffMin)],
      );
      for (const r of rows) {
        await query(
          `UPDATE user_sessions
              SET logout_at = NOW(),
                  logout_type = 'timeout',
                  status = 'offline'
            WHERE id = $1`,
          [r.id],
        );
        if (r.employee_id) {
          // Only close attendance if this was the last live session for
          // the employee — multi-PC users stay checked in.
          const { rows: liveRows } = await query(
            `SELECT 1 FROM user_sessions s
               JOIN users u ON u.id = s.user_id
              WHERE u.employee_id = $1 AND s.logout_at IS NULL
              LIMIT 1`,
            [r.employee_id],
          );
          if (!liveRows.length) {
            await attendanceService.checkOutSafe({
              employeeId: r.employee_id,
              method: 'timeout',
              userId: r.user_id,
              io,
            });
          }
        }
        io.emit('user_offline', {
          userId: r.user_id,
          pcIdentifier: r.pc_identifier,
          logoutType: 'timeout',
        });
      }
    } catch (err) {
      // ignore — best-effort
    }
  }, IDLE_CHECK_INTERVAL_MS);

  // Periodic idle sweeper.
  setInterval(async () => {
    try {
      const { rows } = await query(
        `SELECT id, user_id FROM user_sessions
          WHERE logout_at IS NULL
            AND status = 'online'
            AND last_activity_at < NOW() - INTERVAL '5 minutes'`,
      );
      if (!rows.length) return;
      await query(
        `UPDATE user_sessions SET status = 'idle'
          WHERE id = ANY($1)`,
        [rows.map((r) => r.id)],
      );
      for (const r of rows) {
        io.emit('user_idle', { userId: r.user_id });
      }
    } catch (err) {
      // ignore
    }
  }, IDLE_CHECK_INTERVAL_MS);

  return io;
}

module.exports = { attachSocket, IDLE_THRESHOLD_MS };
