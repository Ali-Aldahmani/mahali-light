const bcrypt = require('bcrypt');
const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { signToken, loadUserContext, hashToken } = require('../middleware/auth');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { ok } = require('../utils/response');
const { logActivity } = require('../utils/activityLog');
const attendanceService = require('../services/attendanceService');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
  pcIdentifier: z.string().min(1).max(50).default('unknown-pc'),
  hostname: z.string().max(100).optional(),
});

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

async function recordAttempt({ username, ipAddress, pcIdentifier, success }) {
  await query(
    `INSERT INTO login_attempts (username, ip_address, pc_identifier, success)
     VALUES ($1,$2,$3,$4)`,
    [username, ipAddress, pcIdentifier, success],
  );
}

async function isLockedOut(username) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS fails
       FROM login_attempts
      WHERE username = $1
        AND success = false
        AND attempted_at > NOW() - make_interval(mins => $2)`,
    [username, LOCK_WINDOW_MINUTES],
  );
  return rows[0].fails >= MAX_FAILED_ATTEMPTS;
}

async function upsertPcRegistry({ pcIdentifier, hostname, ipAddress }) {
  await query(
    `INSERT INTO pc_registry (pc_identifier, hostname, ip_address, last_seen)
     VALUES ($1,$2,$3, NOW())
     ON CONFLICT (pc_identifier) DO UPDATE
       SET hostname = COALESCE(EXCLUDED.hostname, pc_registry.hostname),
           ip_address = COALESCE(EXCLUDED.ip_address, pc_registry.ip_address),
           last_seen = NOW()`,
    [pcIdentifier, hostname || null, ipAddress],
  );
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role_name,
    roleId: user.role_id,
    employeeId: user.employee_id,
    permissions: user.permissions,
  };
}

async function login(req, res, next) {
  try {
    const parsed = loginSchema.parse(req.body || {});
    const { username, password, pcIdentifier } = parsed;
    const hostname = parsed.hostname || pcIdentifier;
    const ipAddress = clientIp(req);

    if (await isLockedOut(username)) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      throw new AppError(ERROR_CODES.AUTH_ACCOUNT_LOCKED, undefined, { status: 423 });
    }

    const { rows } = await query(
      `SELECT u.id, u.username, u.password_hash, u.is_active, u.role_id
         FROM users u
        WHERE u.username = $1`,
      [username],
    );
    const userRow = rows[0];
    if (!userRow) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      throw new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, undefined, { status: 401 });
    }
    if (!userRow.is_active) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      throw new AppError(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, undefined, { status: 403 });
    }

    const ok2 = await bcrypt.compare(password, userRow.password_hash);
    if (!ok2) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      throw new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, undefined, { status: 401 });
    }

    const user = await loadUserContext(userRow.id);
    const token = signToken({ sub: user.id, username: user.username });

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO user_sessions
           (user_id, pc_identifier, ip_address, token_hash, status)
         VALUES ($1,$2,$3,$4,'online')`,
        [user.id, pcIdentifier, ipAddress, hashToken(token)],
      );
      await client.query(
        `INSERT INTO pc_registry (pc_identifier, hostname, ip_address, last_seen)
         VALUES ($1,$2,$3, NOW())
         ON CONFLICT (pc_identifier) DO UPDATE
           SET hostname = COALESCE(EXCLUDED.hostname, pc_registry.hostname),
               ip_address = COALESCE(EXCLUDED.ip_address, pc_registry.ip_address),
               last_seen = NOW()`,
        [pcIdentifier, hostname, ipAddress],
      );
    });

    await recordAttempt({ username, ipAddress, pcIdentifier, success: true });

    // Attendance auto check-in (Phase 11). Idempotent — only opens a record
    // if one doesn't already exist for the employee today, so multi-PC
    // logins don't clobber the original check-in time. Errors are swallowed
    // so they can never block authentication.
    const io = req.app.get('io');
    if (user.employee_id) {
      await attendanceService.checkInSafe({
        employeeId: user.employee_id,
        method: 'app_login',
        userId: user.id,
        io,
      });
    }

    await logActivity({
      entityType: 'user',
      entityId: user.id,
      action: 'user.login',
      performedBy: user.id,
      notes: `PC ${pcIdentifier} (${ipAddress})`,
    });
    await logActivity({
      entityType: 'app',
      entityId: pcIdentifier,
      action: 'app.started',
      performedBy: user.id,
      notes: `Login from ${pcIdentifier}`,
    });

    // Broadcast presence over websocket.
    if (io) {
      io.emit('user_online', {
        userId: user.id,
        username: user.username,
        role: user.role_name,
        pcIdentifier,
      });
    }

    return ok(res, { token, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await query(
      `UPDATE user_sessions
          SET logout_at = NOW(),
              logout_type = 'manual',
              status = 'offline'
        WHERE id = $1`,
      [req.sessionId],
    );

    const { rows } = await query(
      'SELECT pc_identifier FROM user_sessions WHERE id = $1',
      [req.sessionId],
    );
    const pcIdentifier = rows[0]?.pc_identifier;

    const io = req.app.get('io');

    // Attendance auto check-out — only fires if no other live session for
    // the same employee. Multi-PC users stay checked in until the last
    // device logs out / disconnects.
    if (req.user.employee_id) {
      const { rows: liveRows } = await query(
        `SELECT 1 FROM user_sessions s
           JOIN users u ON u.id = s.user_id
          WHERE u.employee_id = $1
            AND s.logout_at IS NULL
            AND s.id <> $2
          LIMIT 1`,
        [req.user.employee_id, req.sessionId],
      );
      if (!liveRows.length) {
        await attendanceService.checkOutSafe({
          employeeId: req.user.employee_id,
          method: 'app_logout',
          userId: req.user.id,
          io,
        });
      }
    }

    await logActivity({
      entityType: 'user',
      entityId: req.user.id,
      action: 'user.logout',
      performedBy: req.user.id,
      notes: `Manual logout (PC ${pcIdentifier || 'unknown'})`,
    });

    if (io) {
      io.emit('user_offline', {
        userId: req.user.id,
        pcIdentifier,
        logoutType: 'manual',
      });
    }

    return ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const user = await loadUserContext(req.user.id);
    const token = signToken({ sub: user.id, username: user.username });

    await query(
      `UPDATE user_sessions
          SET token_hash = $1, last_activity_at = NOW()
        WHERE id = $2`,
      [hashToken(token), req.sessionId],
    );

    return ok(res, { token, user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await loadUserContext(req.user.id);
    if (!user) {
      throw new AppError(ERROR_CODES.AUTH_TOKEN_INVALID, undefined, { status: 401 });
    }
    return ok(res, { user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, logout, refresh, me };
