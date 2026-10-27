const { Server } = require('socket.io');
const { verifyToken, hashToken, loadUserContext } = require('../middleware/auth');
const { query } = require('../db/postgres');
const { isAllowedOrigin } = require('../utils/corsOrigins');
const presenceService = require('../services/presenceService');
const sessionPolicy = require('../services/sessionPolicy');
const { permissionRooms } = require('./events');
const { isSecureHandshake } = require('../middleware/secureTransport');

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

// allowedOrigins is the same Set used by the Express CORS middleware so both
// the HTTP and WebSocket upgrade paths enforce the same origin policy.
function attachSocket(httpServer, allowedOrigins = new Set(), { requireSecure = false, trustProxy = () => null } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Allow: no origin (same-origin / curl), Electron file:// ("null"),
        // or an explicitly whitelisted web origin.
        if (isAllowedOrigin(origin)) {
          return cb(null, true);
        }
        cb(new Error(`Origin "${origin}" not allowed`));
      },
      methods: ['GET', 'POST'],
    },
  });

  // After a restart no socket is connected yet, so no session is "online"
  // until its screen reconnects (presence audit F11). Sessions stay signed
  // in; reconnecting marks them online again.
  query(
    `UPDATE user_sessions SET status = 'offline'
      WHERE logout_at IS NULL AND status <> 'offline'`,
  ).catch(() => {});

  // Authenticate the socket via JWT in handshake.auth.token.
  io.use(async (socket, next) => {
    try {
      // Same rule as the HTTP API (middleware/secureTransport.js): the token
      // in this handshake must not have crossed the network in plain text.
      if (requireSecure && !isSecureHandshake(socket, trustProxy())) {
        return next(new Error('HTTPS_REQUIRED'));
      }
      // Auth token must come from the handshake auth payload, never the
      // query string — query params get written to access/proxy logs.
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('AUTH_TOKEN_MISSING'));

      const payload = verifyToken(token);

      const { rows } = await query(
        `SELECT s.id AS session_id, s.pc_identifier, u.username, r.name AS role_name,
                e.name AS employee_name
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN roles r ON r.id = u.role_id
           LEFT JOIN employees e ON e.id = u.employee_id
          WHERE s.token_hash = $1 AND s.logout_at IS NULL AND u.is_active
            AND (s.absolute_expires_at IS NULL OR s.absolute_expires_at > NOW())
          ORDER BY s.login_at DESC LIMIT 1`,
        [hashToken(token)],
      );
      if (!rows.length) return next(new Error('AUTH_SESSION_EXPIRED'));

      // Effective permissions decide which live events this socket gets
      // (server/socket/events.js). A role or permission change drops the
      // user's sockets, so they are read again on reconnect.
      const user = await loadUserContext(payload.sub);
      if (!user?.is_active) return next(new Error('AUTH_SESSION_EXPIRED'));

      socket.data.permissions = user.permissions || [];
      socket.data.userId = payload.sub;
      socket.data.username = rows[0].username;
      socket.data.employeeName = rows[0].employee_name || null;
      socket.data.role = rows[0].role_name;
      socket.data.sessionId = rows[0].session_id;
      socket.data.pcIdentifier = rows[0].pc_identifier;

      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? 'AUTH_SESSION_EXPIRED' : 'AUTH_TOKEN_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, username, employeeName, role, pcIdentifier, sessionId, permissions } = socket.data;

    socket.join(`user:${userId}`);
    // Per-session room used for targeted force-logout. Named after the
    // session UUID, not the token, so the room name reveals no credentials.
    socket.join(`session:${sessionId}`);
    // One room per effective permission, for broadcast events.
    socket.join(permissionRooms(permissions));
    // The role room is only for dropping these sockets when the role's
    // permissions change (presenceService.refreshRoleSockets). Events are
    // never sent to it.
    if (role) socket.join(`role:${role}`);
    // Presence viewers get live updates.
    if (presenceService.canViewPresence(permissions)) {
      socket.join(presenceService.OBSERVERS_ROOM);
    }

    socket.emit('connected', {
      userId, username, role, idleSignOutMinutes: sessionPolicy.IDLE_SIGNOUT_MINUTES,
    });

    // A (re)connect is activity: mark the session online straight away
    // rather than at the next heartbeat, then tell the viewers.
    query(
      `UPDATE user_sessions SET status = 'online', last_activity_at = NOW(), last_seen_at = NOW()
        WHERE id = $1 AND logout_at IS NULL`,
      [sessionId],
    )
      .then(() => presenceService.publishUserPresence(io, userId))
      .catch(() => {});

    // A heartbeat only refreshes a session that is still open and within its
    // maximum length; otherwise the socket is cut, so a closed session can
    // never be brought back to "online" by a client that kept running. The
    // socket outlives token refreshes: it belongs to the session, which the
    // handshake checked.
    //
    // `active` says whether the screen saw real input since the last beat
    // (presence audit F08): only then is it activity that keeps the user
    // online rather than idle. Every beat marks the connection as seen.
    // Older screens send no payload and count as active, as before.
    // Writes are skipped when nothing changed in the last 20 seconds, so
    // many open tabs don't each write every beat (F16).
    socket.on('heartbeat', async (payload) => {
      try {
        const active = payload?.active !== false;
        const { rows: live } = await query(
          `UPDATE user_sessions s
              SET last_seen_at = NOW(),
                  last_activity_at = CASE WHEN $2 THEN NOW() ELSE s.last_activity_at END,
                  status = CASE WHEN $2 THEN 'online' ELSE s.status END
             FROM user_sessions prev
            WHERE s.id = $1 AND prev.id = s.id AND s.logout_at IS NULL
              AND (s.absolute_expires_at IS NULL OR s.absolute_expires_at > NOW())
              AND (s.last_seen_at IS NULL OR s.last_seen_at < NOW() - INTERVAL '20 seconds'
                   OR ($2 AND s.status <> 'online'))
            RETURNING prev.status AS previous_status`,
          [sessionId, active],
        );
        if (!live.length) {
          // Either throttled, or the session is closed: only the latter cuts.
          const { rows: open } = await query(
            `SELECT 1 FROM user_sessions WHERE id = $1 AND logout_at IS NULL
                AND (absolute_expires_at IS NULL OR absolute_expires_at > NOW())`,
            [sessionId],
          );
          if (!open.length) socket.disconnect(true);
          return;
        }
        if (active && live[0].previous_status !== 'online') {
          await presenceService.publishUserPresence(io, userId);
        }
      } catch (err) {
        // ignore; heartbeats are best-effort
      }
    });

    // Purchase Order discussion room subscription with permission validation
    socket.on('join_po_discussion', async (payload, callback) => {
      try {
        const poId = payload?.poId;
        if (!poId) {
          if (typeof callback === 'function') callback({ success: false, error: 'MISSING_PO_ID' });
          return;
        }

        const user = await loadUserContext(userId);
        if (!user || !user.is_active) {
          if (typeof callback === 'function') callback({ success: false, error: 'UNAUTHORIZED' });
          return;
        }

        const owned = new Set(user.permissions || []);
        if (!owned.has('*') && !owned.has('po.comments.view')) {
          if (typeof callback === 'function') callback({ success: false, error: 'NO_PERMISSION' });
          return;
        }

        const { rows } = await query('SELECT id FROM purchase_orders WHERE id = $1', [poId]);
        if (!rows.length) {
          if (typeof callback === 'function') callback({ success: false, error: 'PO_NOT_FOUND' });
          return;
        }

        socket.join(`po_discussion:${poId}`);
        if (typeof callback === 'function') callback({ success: true, poId });
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: 'INTERNAL_ERROR' });
      }
    });

    socket.on('leave_po_discussion', (payload, callback) => {
      const poId = payload?.poId;
      if (poId) {
        socket.leave(`po_discussion:${poId}`);
      }
      if (typeof callback === 'function') callback({ success: true, poId });
    });

    socket.on('disconnect', async () => {
      try {
        // Another tab can share this session: it stays online while any of
        // its sockets is still connected.
        const remaining = await io.in(`session:${sessionId}`).fetchSockets();
        if (remaining.length) return;
        // Mark session offline but do NOT set logout_at — the user may still
        // be authenticated; explicit logout is required for that. A closed
        // session was already published by whatever closed it.
        const { rowCount } = await query(
          `UPDATE user_sessions SET status = 'offline'
            WHERE id = $1 AND logout_at IS NULL AND status <> 'offline'`,
          [sessionId],
        );
        if (rowCount) await presenceService.publishUserPresence(io, userId);
      } catch (err) {
        // ignore
      }
    });
  });

  // Sign-out sweeper: idle tills, closed screens and sessions past their
  // maximum length (services/sessionPolicy.js).
  setInterval(() => {
    sessionPolicy.sweepSessions(io).catch(() => {});
  }, IDLE_CHECK_INTERVAL_MS).unref();

  // Periodic idle sweeper. Same conditional UPDATE, so newer activity is
  // never overwritten with 'idle'.
  setInterval(async () => {
    try {
      const { rows } = await query(
        `UPDATE user_sessions SET status = 'idle'
          WHERE logout_at IS NULL
            AND status = 'online'
            AND last_activity_at < NOW() - INTERVAL '5 minutes'
          RETURNING user_id`,
      );
      for (const userId of new Set(rows.map((r) => r.user_id))) {
        await presenceService.publishUserPresence(io, userId);
      }
    } catch (err) {
      // ignore
    }
  }, IDLE_CHECK_INTERVAL_MS).unref();

  return io;
}

module.exports = { attachSocket, IDLE_THRESHOLD_MS };
