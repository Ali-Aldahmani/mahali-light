require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, query } = require('./postgres');

// The backup tables only exist once this migration has run. On a fresh
// install there is no data to protect, so no pre-migration backup is taken.
const BACKUP_SCHEMA_MIGRATION = '017_backup.sql';

// Take a DB backup before upgrading an existing install. Uses the normal
// backup pipeline so it is encrypted, lands in the usual destinations and
// shows up in Settings -> Backups. If the backup fails we refuse to migrate:
// an upgrade without a restore point is exactly what this guards against.
// Escape hatch (operator only): MIGRATE_WITHOUT_BACKUP=1.
async function backupBeforeMigrating(pending) {
  if (process.env.MIGRATE_WITHOUT_BACKUP === '1') {
    console.warn('[migrate] MIGRATE_WITHOUT_BACKUP=1 - skipping pre-migration backup');
    return;
  }
  console.log(`[migrate] ${pending.length} pending migration(s) - backing up database first...`);
  // Lazy require: backupService pulls in half the app.
  const backupService = require('../backup/backupService');
  let result;
  try {
    result = await backupService.runBackup({
      type: 'db_only',
      triggeredBy: 'pre_migration',
      scheduleKey: 'pre-migration',
    });
  } catch (err) {
    throw new Error(
      `[migrate] pre-migration backup failed, database NOT upgraded: ${err.message}. ` +
        'Fix the backup (Settings -> Backups) or set MIGRATE_WITHOUT_BACKUP=1 to override.',
    );
  }
  if (!result || result.status === 'failed') {
    throw new Error(
      '[migrate] pre-migration backup did not reach any destination, database NOT upgraded. ' +
        'Fix the backup (Settings -> Backups) or set MIGRATE_WITHOUT_BACKUP=1 to override.',
    );
  }
  console.log(`[migrate] pre-migration backup ${result.jobNumber} ${result.status}.`);
}

// One fixed key for pg_advisory_lock, so a boot and `npm run migrate` (or two
// API instances) never run the migration loop at the same time (audit F-MIG-02).
const MIGRATION_LOCK_KEY = 72_310_001;

// Old code must not start against a database that newer code has already
// migrated: it would write to columns, triggers and constraints it doesn't
// know about (audit F-UPD-01, e.g. after an in-app update followed by a
// container recreate). Operator override for a deliberate rollback only.
function assertSchemaNotNewer(appliedSet, shippedFiles) {
  const shipped = new Set(shippedFiles);
  const unknown = [...appliedSet].filter((f) => !shipped.has(f)).sort();
  if (!unknown.length) return;
  if (process.env.MIGRATE_ALLOW_NEWER_SCHEMA === '1') {
    console.warn(
      `[migrate] MIGRATE_ALLOW_NEWER_SCHEMA=1 - starting although the database has ${unknown.length} ` +
        `migration(s) this version does not ship: ${unknown.join(', ')}`,
    );
    return;
  }
  const err = new Error(
    `[migrate] The database was upgraded by a newer version of the app (it has ${unknown.length} ` +
      `migration(s) this version does not know: ${unknown.join(', ')}). Refusing to start old code ` +
      'on a newer database. Install the newer version again, or restore the backup taken before the ' +
      'upgrade. Set MIGRATE_ALLOW_NEWER_SCHEMA=1 only for a deliberate, checked rollback.',
  );
  err.code = 'SCHEMA_NEWER_THAN_CODE';
  throw err;
}

// stopBefore: apply only files that sort before this filename prefix. Lets
// tests seed data in an older schema and then migrate it forward.
// preMigrationBackup: back up an existing database before applying pending
// migrations (server boot + `npm run migrate`; off by default for tests).
async function runMigrations({ stopBefore, preMigrationBackup = false } = {}) {
  console.log('[migrate] starting migrations...');

  const lockClient = await getPool().connect();
  let releaseErr;
  try {
    // Waiting for another runner is not a stuck lock: lift the pool's
    // lock/statement timeouts for this wait (reset before release).
    await lockClient.query('SET lock_timeout = 0; SET statement_timeout = 0');
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await runMigrationsLocked({ stopBefore, preMigrationBackup });
  } finally {
    // If unlocking fails the connection is unusable: discard it (closing
    // the session also drops the advisory lock).
    await lockClient
      .query(
        `SELECT pg_advisory_unlock(${Number(MIGRATION_LOCK_KEY)}); RESET lock_timeout; RESET statement_timeout`,
      )
      .catch(() => null);
    await lockClient
      .query('SELECT 1')
      .catch((err) => {
        releaseErr = err;
      });
    lockClient.release(releaseErr);
  }
}

async function runMigrationsLocked({ stopBefore, preMigrationBackup }) {
  // Ensure the migration tracking table exists before reading it.
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename VARCHAR(255) PRIMARY KEY,
      ran_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const allFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const files = allFiles.filter((f) => !stopBefore || f < stopBefore);

  // Read after taking the lock, so a runner that waited sees what the other
  // one applied and skips it.
  const { rows: applied } = await query('SELECT filename FROM _migrations');
  const appliedSet = new Set(applied.map((r) => r.filename));

  assertSchemaNotNewer(appliedSet, allFiles);

  const pending = files.filter((f) => !appliedSet.has(f));
  if (preMigrationBackup && pending.length && appliedSet.has(BACKUP_SCHEMA_MIGRATION)) {
    await backupBeforeMigrating(pending);
  }

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
    let releaseErr;
    try {
      await client.query('BEGIN');
      // A schema change may legitimately wait for locks or run long on a big
      // table; the pool's safety timeouts are meant for till requests.
      await client.query('SET LOCAL lock_timeout = 0; SET LOCAL statement_timeout = 0');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
    } catch (err) {
      // A failing ROLLBACK (dead connection) must not hide the real error,
      // and that connection must not go back into the pool (audit F-TX-08).
      await client.query('ROLLBACK').catch((rbErr) => {
        releaseErr = rbErr;
      });
      console.error(`[migrate] failed ${file}`, err);
      throw err;
    } finally {
      client.release(releaseErr);
    }
  }
  console.log('[migrate] done.');
}

if (require.main === module) {
  runMigrations({ preMigrationBackup: true })
    .then(() => getPool().end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations, assertSchemaNotNewer, MIGRATION_LOCK_KEY };
