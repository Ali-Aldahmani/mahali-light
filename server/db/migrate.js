require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, query } = require('./postgres');

async function runMigrations() {
  console.log('[migrate] starting migrations...');

  // Ensure the migration tracking table exists before reading it.
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename VARCHAR(255) PRIMARY KEY,
      ran_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await query('SELECT filename FROM _migrations');
  const appliedSet = new Set(applied.map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[migrate] skip  ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[migrate] apply ${file}`);
    // Check out a dedicated client so that BEGIN, the migration SQL, the
    // _migrations INSERT, and COMMIT all run on the SAME connection.
    // Using pool.query() for each statement (the old approach) gave no
    // atomicity guarantee: each call could land on a different pool connection,
    // leaving BEGIN's transaction unrelated to the subsequent queries.
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] failed ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('[migrate] done.');
}

if (require.main === module) {
  runMigrations()
    .then(() => getPool().end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
