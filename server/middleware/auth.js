const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// One-way hash applied to every JWT before it touches the database.
// Storing only the hash means a full DB read gives an attacker no usable
// tokens — the original JWT (needed to call the API) is never persisted.
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// Every token gets a random ID (jti). Without it two logins by the same user
// in the same second produced identical tokens, whose identical hashes then
// collided on user_sessions.token_hash.
//
// A token lasts 30 minutes (ACCESS_TOKEN_TTL); the app swaps it for a new one
// before then, up to the session's maximum length (authentication audit
// AUTH-02). JWT_EXPIRES_IN is no longer read: an 8-hour token copied from a
// till stayed usable long after the person left.
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '30m';

// Seconds a new token lasts, capped so it never outlives its session's
// maximum length.
function tokenSecondsUntil(sessionExpiresAt) {
  const m = /^(d+)s*([smh]?)$/.exec(String(ACCESS_TOKEN_TTL).trim());
  const ttl = m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[m[2]] || 1) : 1800;
  if (!sessionExpiresAt) return ttl;
  const left = Math.floor((new Date(sessionExpiresAt).getTime() - Date.now()) / 1000);
  return Math.max(1, Math.min(ttl, left));
}

function signToken(payload, opts = {}) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL,
    jwtid: crypto.randomUUID(),
    ...opts,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function loadUserContext(userId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.is_active, u.employee_id,
            r.id AS role_id, r.name AS role_name, r.is_system AS role_is_system,
            e.name AS full_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE u.id = $1`,
    [userId],
  );
  if (!rows.length) return null;
  const user = rows[0];
  // Expose a canonical `role` field so controllers can use either
  // req.user.role (short form) or req.user.role_name without breakage.
  user.role = user.role_name;

  // Role-level permissions
  const { rows: permRows } = await query(
    `SELECT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [user.role_id],
  );
  const roleKeys = new Set(permRows.map((p) => p.key));

  // User-level overrides: granted=true adds beyond the role, granted=false
  // removes a permission even when the role provides it.
  const { rows: overrideRows } = await query(
    `SELECT p.key, up.granted
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = $1`,
    [userId],
  );
  const effective = new Set(roleKeys);
  for (const { key, granted } of overrideRows) {
    if (granted) effective.add(key);
    else effective.delete(key);
  }

  user.permissions = Array.from(effective);
  return user;
}

// The session a token belongs to: its current token, or the one it replaced
// within the last minute (a request already on its way during a refresh).
async function findSessionByToken(token) {
  const hash = hashToken(token);
  const { rows } = await query(
    `SELECT id, logout_at, status, absolute_expires_at,
            (absolute_expires_at IS NOT NULL AND absolute_expires_at <= NOW()) AS past_max_length
       FROM user_sessions
      WHERE token_hash = $1
         OR (previous_token_hash = $1 AND token_rotated_at > NOW() - INTERVAL '1 minute')
      ORDER BY login_at DESC LIMIT 1`,
    [hash],
  );
  return rows;
}

function requireAuth() {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) {
        return next(
          new AppError(ERROR_CODES.AUTH_TOKEN_MISSING, undefined, { status: 401 }),
        );
      }
      const token = header.slice('Bearer '.length).trim();

      let payload;
      try {
        payload = verifyToken(token);
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return next(
            new AppError(ERROR_CODES.AUTH_SESSION_EXPIRED, undefined, { status: 401 }),
          );
        }
        return next(
          new AppError(ERROR_CODES.AUTH_TOKEN_INVALID, undefined, { status: 401 }),
        );
      }

      // Confirm session is still active. Look up by hash — the plaintext
      // token is never stored in the database (see migration 020_token_hash).
      const sess = await findSessionByToken(token);
      if (!sess.length || sess[0].logout_at || sess[0].past_max_length) {
        return next(
          new AppError(ERROR_CODES.AUTH_SESSION_EXPIRED, undefined, { status: 401 }),
        );
      }

      const user = await loadUserContext(payload.sub);
      if (!user) {
        return next(
          new AppError(ERROR_CODES.AUTH_TOKEN_INVALID, undefined, { status: 401 }),
        );
      }
      if (!user.is_active) {
        return next(
          new AppError(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, undefined, { status: 403 }),
        );
      }

      req.user = user;
      req.token = token;
      req.sessionId = sess[0].id;
      req.sessionExpiresAt = sess[0].absolute_expires_at;
      // Only real input on the screen counts as activity (authentication
      // audit AUTH-03), or background requests would keep an unattended till
      // signed in. The app says so with X-User-Active on the first request
      // after input; screens without a live connection (the phone app)
      // depend on it. Writes are skipped within 20 seconds of the last one.
      const active = req.headers['x-user-active'] === '1';
      query(
        `UPDATE user_sessions
            SET last_seen_at = NOW(),
                last_activity_at = CASE WHEN $2 THEN NOW() ELSE last_activity_at END,
                status = CASE WHEN $2 THEN 'online' ELSE status END
          WHERE id = $1 AND logout_at IS NULL
            AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '20 seconds'
                 OR ($2 AND last_activity_at < NOW() - INTERVAL '20 seconds'))`,
        [sess[0].id, active],
      ).catch(() => {});

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  requireAuth, signToken, verifyToken, loadUserContext, hashToken, findSessionByToken, tokenSecondsUntil,
};
