const crypto = require('crypto');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Retry-safe money and stock commands (see migration 040).
//
// `runOnce` runs `work` inside the caller's transaction and records the
// result under (scope, key). Sending the same key again — after a timeout,
// a lost response, a double click or a second device — returns the stored
// result instead of doing the work twice. A key reused with different
// details is refused with 409 IDEMPOTENCY_KEY_REUSED.
//
// Every screen now sends a key, so the HTTP routes ask for one with
// `requestKeyFrom(req, { required: true })`. Without a key `runOnce` still
// simply runs the work, for internal callers that are not retried.

const MAX_KEY_LENGTH = 128;

// Stable JSON: object keys sorted, so the same payload always hashes the same.
function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(canonical(payload)).digest('hex');
}

// The key a request carries: the Idempotency-Key header, else body.requestKey.
// With `required`, a request without one is refused — a page loaded before
// the update is the only sender left, and reloading it fixes that.
function requestKeyFrom(req, { required = false } = {}) {
  const raw = (req.get && req.get('Idempotency-Key')) || req.body?.requestKey || null;
  if (raw == null || raw === '') {
    if (!required) return null;
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'This screen is out of date. Reload the page and try again.',
      { status: 400, details: { reason: 'missing_request_key' } },
    );
  }
  const key = String(raw).trim();
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid request key.', { status: 400 });
  }
  return key;
}

/**
 * @param client  the open transaction the command runs in
 * @param opts    { scope, key, payload, userId }
 * @param work    async () => result (JSON-serialisable)
 * @returns       { result, replayed }
 */
async function runOnce(client, { scope, key, payload, userId = null }, work) {
  if (!key) return { result: await work(), replayed: false };

  const hash = payloadHash(payload);
  // Same-key requests that arrive together wait here for the first to
  // finish, then see its row.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${scope}:${key}`]);

  const { rows } = await client.query(
    `SELECT payload_hash, result FROM operations WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  if (rows.length) {
    if (rows[0].payload_hash !== hash) {
      throw new AppError(ERROR_CODES.IDEMPOTENCY_KEY_REUSED, undefined, { status: 409 });
    }
    return { result: rows[0].result, replayed: true };
  }

  const result = await work();
  await client.query(
    `INSERT INTO operations (scope, key, payload_hash, result, user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [scope, key, hash, JSON.stringify(result ?? null), userId],
  );
  return { result, replayed: false };
}

module.exports = { runOnce, requestKeyFrom, payloadHash, canonical };
