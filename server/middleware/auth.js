const jwt = require('jsonwebtoken');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

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

  const { rows: permRows } = await query(
    `SELECT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [user.role_id],
  );
  user.permissions = permRows.map((p) => p.key);
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

      // Confirm session is still active.
      const { rows: sess } = await query(
        `SELECT id, logout_at, status FROM user_sessions
          WHERE token = $1 ORDER BY login_at DESC LIMIT 1`,
        [token],
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

module.exports = { requireAuth, signToken, verifyToken, loadUserContext };
