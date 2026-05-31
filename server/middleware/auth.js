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

function signToken(payload, opts = {}) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    ...opts,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function loadUserContext(userId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.is_active, u.employee_id,
            r.id AS role_id, r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
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
      const { rows: sess } = await query(
        `SELECT id, logout_at, status FROM user_sessions
          WHERE token_hash = $1 ORDER BY login_at DESC LIMIT 1`,
        [hashToken(token)],
      );
      if (!sess.length || sess[0].logout_at) {
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

      // Touch last_activity_at; best-effort.
      query('UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1', [
        sess[0].id,
      ]).catch(() => {});

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, signToken, verifyToken, loadUserContext, hashToken };
