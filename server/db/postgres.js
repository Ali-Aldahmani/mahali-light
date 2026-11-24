const { Pool } = require('pg');
const { STORE_TIMEZONE } = require('../utils/dates');

let pool;

// A PostgreSQL duration ("10s", "500ms", "0" = off) from the environment.
// Anything else falls back to the default rather than reaching the server
// inside a connection option string.
function durationSetting(name, fallback) {
  const v = String(process.env[name] ?? '').trim();
  return /^\d+(ms|s|min)?$/.test(v) ? v : fallback;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'mahali_light',
      min: Number(process.env.PGPOOL_MIN || 2),
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_MS || 2000),
      // Session timezone = store timezone, so ::date, CURRENT_DATE and
      // date_trunc bucket by the store's business day instead of UTC.
      // Timeouts (audit F-OPS-03): one hung transaction or runaway query must
      // not block every till. Sales wait on the drawer row FOR UPDATE, so a
      // lock wait gives up after a few seconds and the client gets a
      // retryable DB_BUSY (errorLogService.classifyError). Migrations lift
      // these per transaction (migrate.js).
      options: [
        `-c timezone=${STORE_TIMEZONE}`,
        `-c lock_timeout=${durationSetting('PG_LOCK_TIMEOUT', '10s')}`,
        `-c idle_in_transaction_session_timeout=${durationSetting('PG_IDLE_IN_TX_TIMEOUT', '60s')}`,
        `-c statement_timeout=${durationSetting('PG_STATEMENT_TIMEOUT', '120s')}`,
      ].join(' '),
    });

    pool.on('error', (err) => {
      console.error('[postgres] unexpected pool error', err);
    });
    // The pool only listens for errors on idle connections. A connection
    // that dies while a transaction has it checked out (server restart,
    // network drop, terminated backend) emits 'error' on the client; with no
    // listener that is an uncaught exception, and the process now exits on
    // those (middleware/errors.js). The query in progress still fails with
    // its own error, and the pool discards the dead connection on release.
    pool.on('connect', (client) => {
      client.on('error', (err) => {
        console.error('[postgres] connection lost while in use:', err?.message || err);
      });
    });
  }
  return pool;
}

async function waitForDatabase({ attempts = 30, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await query('SELECT 1');
      if (i > 1) console.log(`[postgres] ready after ${i} attempt(s)`);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[postgres] not ready (${i}/${attempts}): ${err.code || err.message}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function query(text, params) {
  return getPool().query(text, params);
}

const DEADLOCK = '40P01';

// For the rest of this transaction, who is making changes (app.user_id).
function setActor(client, userId, extra = {}) {
  const pairs = [['app.user_id', userId], ...Object.entries(extra)];
  return client.query(
    `SELECT ${pairs.map((_, i) => `set_config($${i * 2 + 1}, $${i * 2 + 2}, true)`).join(', ')}`,
    pairs.flatMap(([k, v]) => [k, v == null ? '' : String(v)]),
  );
}

// retryOnDeadlock: when PostgreSQL aborts the transaction as a deadlock
// victim, run the whole callback again (up to 3 attempts). Only for callbacks
// whose effects are all inside the transaction: no sockets, files or other
// side effects before COMMIT.
// actorId: who is making the change, for database triggers that record
// history (price changes, edits to confirmed sales, lead times). Same as
// setActor(client, id) at the start of the transaction.
async function withTransaction(fn, { retryOnDeadlock = false, actorId = null } = {}) {
  const attempts = retryOnDeadlock ? 3 : 1;
  let releaseErr;
  for (let attempt = 1; ; attempt += 1) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (actorId) await setActor(client, actorId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      // A ROLLBACK that fails (dead connection) must not replace the real
      // error, and that connection must not return to the pool (audit F-TX-08).
      await client.query('ROLLBACK').catch((rbErr) => {
        releaseErr = rbErr;
      });
      if (err.code !== DEADLOCK || attempt >= attempts) throw err;
    } finally {
      client.release(releaseErr);
      releaseErr = undefined;
    }
  }
}

// Graceful shutdown: close the pool so in-flight queries finish and the
// server sees clean disconnects (audit F-OPS-01).
async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

module.exports = { getPool, query, withTransaction, waitForDatabase, setActor, closePool, durationSetting };
