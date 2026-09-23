const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// First-run setup code.
//
// Until setup completes, POST /api/setup/complete creates the Admin account,
// and the API is reachable from the whole LAN. The code proves the caller
// can see the server itself: it is printed to the server log and written
// to setup-code.txt next to the app — never returned over HTTP. (It used to
// be handed to any caller of GET /api/setup/status, so it protected
// nothing, and each call rotated it out from under the real wizard.)
//
// Only its SHA-256 is stored. The code is short enough to type from a
// console (16 chars, ~80 bits; guesses are also rate-limited).
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LENGTH = 16;

function setupCodeFile() {
  return path.resolve(process.env.SETUP_CODE_FILE || path.join(process.cwd(), 'setup-code.txt'));
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(normalizeCode(token)).digest('hex');
}

function generateToken() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out.match(/.{4}/g).join('-');
}

async function currentRow() {
  const { rows } = await query(
    `SELECT setup_token_hash, setup_token_issued_at, setup_completed
       FROM app_settings
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  return rows[0] || null;
}

function isExpired(row) {
  if (!row?.setup_token_hash || !row?.setup_token_issued_at) return true;
  return Date.now() - new Date(row.setup_token_issued_at).getTime() > TOKEN_TTL_MS;
}

function announce(token) {
  const file = setupCodeFile();
  try {
    fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn(`[setup] could not write ${file}: ${err.message}`);
  }
  const bar = '='.repeat(64);
  console.log(
    `\n${bar}\n  FIRST-RUN SETUP CODE:  ${token}\n` +
      '  Enter it on the setup screen to create the Admin account.\n' +
      `  Also saved to: ${file}\n` +
      `  Valid for 24 hours. Restart the server to get a new one.\n${bar}\n`,
  );
}

// Issue a fresh code (only while setup is incomplete), store its hash and
// print it. Returns the code, or null when setup is already complete.
async function issueSetupToken() {
  const token = generateToken();
  const { rows } = await query(
    `UPDATE app_settings
        SET setup_token_hash = $1,
            setup_token_issued_at = NOW(),
            updated_at = NOW()
      WHERE id = (SELECT id FROM app_settings ORDER BY updated_at DESC LIMIT 1)
        AND setup_completed = false
      RETURNING id`,
    [hashToken(token)],
  );
  if (!rows.length) return null;
  announce(token);
  return token;
}

// At boot: always a fresh code while setup is pending, so an operator who
// lost it can restart to get another. Restarting requires server access.
async function issueSetupTokenAtBoot() {
  const row = await currentRow();
  if (!row || row.setup_completed) return null;
  return issueSetupToken();
}

// On status checks: replace an expired code (printed, never returned), but
// never rotate a live one — a LAN caller must not be able to invalidate
// the code the operator is holding.
async function ensureLiveSetupToken() {
  const row = await currentRow();
  if (!row || row.setup_completed || !isExpired(row)) return;
  await issueSetupToken();
}

async function assertValidSetupToken(provided) {
  const raw = normalizeCode(provided);
  if (!raw) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      "Enter the setup code shown in the server's log (or setup-code.txt).",
      { status: 403, details: { reason: 'missing_setup_token' } },
    );
  }
  const row = await currentRow();
  if (!row || row.setup_completed) {
    throw new AppError(
      ERROR_CODES.BIZ_INVALID_STATE,
      'Setup has already been completed.',
      { status: 409 },
    );
  }
  if (isExpired(row)) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Setup code expired. Restart the server to get a new one.',
      { status: 403, details: { reason: 'setup_token_expired' } },
    );
  }
  const expected = Buffer.from(row.setup_token_hash, 'hex');
  const actual = Buffer.from(hashToken(raw), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Invalid setup code.',
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

// Called after setup commits (not inside its transaction, which could still
// roll back and leave the operator without the code).
function removeSetupCodeFile() {
  try {
    fs.rmSync(setupCodeFile(), { force: true });
  } catch (_e) { /* best-effort */ }
}

module.exports = {
  issueSetupToken,
  issueSetupTokenAtBoot,
  ensureLiveSetupToken,
  assertValidSetupToken,
  clearSetupToken,
  removeSetupCodeFile,
  normalizeCode,
  generateToken,
};
