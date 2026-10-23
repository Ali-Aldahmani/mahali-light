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

// stopBefore: apply only files that sort before this filename prefix. Lets
// tests seed data in an older schema and then migrate it forward.
// preMigrationBackup: back up an existing database before applying pending
// migrations (server boot + `npm run migrate`; off by default for tests).
async function runMigrations({ stopBefore, preMigrationBackup = false } = {}) {
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
    .filter((f) => !stopBefore || f < stopBefore)
    .sort();

  const { rows: applied } = await query('SELECT filename FROM _migrations');
  const appliedSet = new Set(applied.map((r) => r.filename));

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
  runMigrations({ preMigrationBackup: true })
    .then(() => getPool().end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
