const crypto = require('crypto');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function issueSetupToken() {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const { rows } = await query(
    `UPDATE app_settings
        SET setup_token_hash = $1,
            setup_token_issued_at = NOW(),
            updated_at = NOW()
      WHERE id = (SELECT id FROM app_settings ORDER BY updated_at DESC LIMIT 1)
        AND setup_completed = false
      RETURNING id`,
    [tokenHash],
  );
  if (!rows.length) return null;
  return token;
}

async function assertValidSetupToken(provided) {
  const raw = (provided || '').toString().trim();
  if (!raw) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Setup token is required. Reload the setup wizard and try again.',
      { status: 403, details: { reason: 'missing_setup_token' } },
    );
  }
  const { rows } = await query(
    `SELECT setup_token_hash, setup_token_issued_at, setup_completed
       FROM app_settings
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row || row.setup_completed) {
    throw new AppError(
      ERROR_CODES.BIZ_INVALID_STATE,
      'Setup has already been completed.',
      { status: 409 },
    );
  }
  if (!row.setup_token_hash || !row.setup_token_issued_at) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Setup token expired. Reload the setup wizard to obtain a new token.',
      { status: 403, details: { reason: 'setup_token_not_issued' } },
    );
  }
  const age = Date.now() - new Date(row.setup_token_issued_at).getTime();
  if (age > TOKEN_TTL_MS) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Setup token expired. Reload the setup wizard to obtain a new token.',
      { status: 403, details: { reason: 'setup_token_expired' } },
    );
  }
  const expected = row.setup_token_hash;
  const actual = hashToken(raw);
  const ok =
    expected.length === actual.length &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  if (!ok) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Invalid setup token.',
      { status: 403, details: { reason: 'invalid_setup_token' } },
    );
  }
}

async function clearSetupToken(client = null) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `UPDATE app_settings
        SET setup_token_hash = NULL,
            setup_token_issued_at = NULL,
            updated_at = NOW()
      WHERE id = (SELECT id FROM app_settings ORDER BY updated_at DESC LIMIT 1)`,
  );
}

module.exports = {
  issueSetupToken,
  assertValidSetupToken,
  clearSetupToken,
};
