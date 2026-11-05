const bcrypt = require('bcrypt');
const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { signToken, loadUserContext, hashToken, tokenSecondsUntil } = require('../middleware/auth');
const { SESSION_MAX_HOURS, IDLE_SIGNOUT_MINUTES } = require('../services/sessionPolicy');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { ok } = require('../utils/response');
const { logActivity } = require('../utils/activityLog');
const attendanceService = require('../services/attendanceService');
const presenceService = require('../services/presenceService');
const { reserveAttempt, clearAttempts } = require('../services/loginLockout');


const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
  pcIdentifier: z.string().min(1).max(50).default('unknown-pc'),
  hostname: z.string().max(100).optional(),
});

// req.ip honours X-Forwarded-For only from the configured proxy allowlist
// (utils/trustProxy.js), so browser tills behind the Next.js rewrite are
// logged with their own address and direct callers can't inject one.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

async function recordAttempt({ username, ipAddress, pcIdentifier, success }) {
  await query(
    `INSERT INTO login_attempts (username, ip_address, pc_identifier, success)
     VALUES ($1,$2,$3,$4)`,
    [username, ipAddress, pcIdentifier, success],
  );
}

// Compared against when the username doesn't exist, so an unknown name takes
// as long as a wrong password and can't be told apart by timing.
let dummyHash = null;
async function compareWithDummy(password) {
  if (!dummyHash) dummyHash = await bcrypt.hash('not-a-real-password', Number(process.env.BCRYPT_ROUNDS || 12));
  await bcrypt.compare(password, dummyHash);
  return false;
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
    full_name: user.full_name || null,
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

    if (await reserveAttempt(username, ipAddress)) {
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
    const passwordOk = userRow
      ? await bcrypt.compare(password, userRow.password_hash)
      : await compareWithDummy(password);
    if (!passwordOk) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      throw new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, undefined, { status: 401 });
    }
    // Authentication audit AUTH-08: an inactive account gets the same answer
    // as a wrong password, checked only after the password, so the login
    // screen doesn't reveal which usernames exist. The real reason is logged.
    if (!userRow.is_active) {
      await recordAttempt({ username, ipAddress, pcIdentifier, success: false });
      await logActivity({
        entityType: 'user',
        entityId: userRow.id,
        action: 'user.login_refused_inactive',
        notes: `PC ${pcIdentifier} (${ipAddress})`,
      });
      throw new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, undefined, { status: 401 });
    }

    const user = await loadUserContext(userRow.id);
    const token = signToken({ sub: user.id, username: user.username });
    const sessionExpiresAt = new Date(Date.now() + SESSION_MAX_HOURS * 3600 * 1000);

    const replaced = await withTransaction(async (client) => {
      // Authentication audit AUTH-07: two logins for the same user on the
      // same PC queue here, so the second closes the first's session instead
      // of both inserting (the unique index from migration 050 backs this).
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `login:${user.id}:${pcIdentifier}`,
      ]);
      // Close any session already open for this user on this PC (e.g. a
      // second tab logging in independently, or a crashed session that
      // never called logout) before opening a new one — otherwise both
      // stay "online" forever and the same person shows up twice in the
      // presence list.
      const { rows: closed } = await client.query(
        `UPDATE user_sessions
            SET logout_at = NOW(), logout_type = 'replaced', status = 'offline'
          WHERE user_id = $1 AND pc_identifier = $2 AND logout_at IS NULL
          RETURNING id`,
        [user.id, pcIdentifier],
      );
      await client.query(
        `INSERT INTO user_sessions
           (user_id, pc_identifier, ip_address, token_hash, status, absolute_expires_at)
         VALUES ($1,$2,$3,$4,'online',$5)`,
        [user.id, pcIdentifier, ipAddress, hashToken(token), sessionExpiresAt],
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
      return closed.map((r) => r.id);
    });

    await recordAttempt({ username, ipAddress, pcIdentifier, success: true });
    await clearAttempts(username, ipAddress);

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
      // entity_id is a UUID column — there's no specific entity row for an
      // "app started" event, and pcIdentifier (e.g. "localhost-web") isn't
      // one, so passing it here silently failed the insert on every single
      // login. The identifier is already captured in `notes` below.
      entityId: null,
      action: 'app.started',
      performedBy: user.id,
      notes: `Login from ${pcIdentifier}`,
    });

    // The replaced sessions' sockets (an old tab on this PC) are cut so they
    // stop receiving events; then the presence viewers get the new state.
    presenceService.disconnectSessions(io, replaced, {
      reason: 'Signed in again on this PC',
    });
    await presenceService.publishUserPresence(io, user.id);

    return ok(res, {
      token, user: sanitizeUser(user), sessionExpiresAt, idleSignOutMinutes: IDLE_SIGNOUT_MINUTES,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE user_sessions
          SET logout_at = NOW(),
              logout_type = 'manual',
              status = 'offline'
        WHERE id = $1
        RETURNING pc_identifier`,
      [req.sessionId],
    );
    const pcIdentifier = rows[0]?.pc_identifier;

    // The session's sockets are cut by the server, not left to the client:
    // a tab that missed the logout must not keep receiving events.
    const io = req.app.get('io');
    presenceService.disconnectSessions(io, [req.sessionId]);

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

    await presenceService.publishUserPresence(io, req.user.id);

    return ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
}

// "Sign out all my devices" (authentication audit AUTH-09): closes every open
// session of the signed-in user, this one included, and cuts their sockets.
// The way back when a till's sign-out never reached the server.
async function logoutAll(req, res, next) {
  try {
    const io = req.app.get('io');
    const sessions = await presenceService.revokeUserSessions(io, {
      userId: req.user.id,
      logoutType: 'manual_all',
      reason: 'Signed out from all devices',
    });
    if (req.user.employee_id) {
      await attendanceService.checkOutSafe({
        employeeId: req.user.employee_id, method: 'app_logout', userId: req.user.id, io,
      });
    }
    await logActivity({
      entityType: 'user',
      entityId: req.user.id,
      action: 'user.logout_all',
      performedBy: req.user.id,
      notes: `Closed ${sessions.length} session(s)`,
    });
    return ok(res, { loggedOut: true, sessionsClosed: sessions.length });
  } catch (err) {
    next(err);
  }
}

// Swap the token for a new one (authentication audit AUTH-02). The session's
// maximum length doesn't move, the new token never outlives it, and the old
// token keeps working for one minute for requests already on their way.
// Refreshing isn't activity: it doesn't hold off the idle sign-out.
async function refresh(req, res, next) {
  try {
    const user = await loadUserContext(req.user.id);
    const token = signToken(
      { sub: user.id, username: user.username },
      { expiresIn: tokenSecondsUntil(req.sessionExpiresAt) },
    );

    await query(
      `UPDATE user_sessions
          SET previous_token_hash = token_hash, token_rotated_at = NOW(), token_hash = $1
        WHERE id = $2 AND logout_at IS NULL`,
      [hashToken(token), req.sessionId],
    );

    return ok(res, { token, user: sanitizeUser(user), sessionExpiresAt: req.sessionExpiresAt });
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

module.exports = { login, logout, logoutAll, refresh, me };
