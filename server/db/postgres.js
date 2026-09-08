const { Pool } = require('pg');

let pool;

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
    });

    pool.on('error', (err) => {
      console.error('[postgres] unexpected pool error', err);
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

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, withTransaction, waitForDatabase };
