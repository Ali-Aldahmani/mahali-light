/**
 * Backup concurrency / crash-recovery regression test.
 *
 * "One backup at a time" used to be enforced by checking for a backup_jobs
 * row with status 'running'. A crash or restart mid-backup left that row
 * behind forever, so every later backup — scheduled or manual — was refused
 * as "already in progress", and the scheduler only console.warn'ed about it.
 * Now a Postgres advisory lock (released automatically when its connection
 * dies) guards the run, orphaned rows are marked failed and reported, and
 * scheduler failures notify Admins.
 *
 * pg_dump is stubbed; the local destination writes to a temp directory.
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);
const BACKUP_LOCK_KEY = 717171001;

describe.skipIf(!enabled)('backup lock and interrupted-job recovery on real PostgreSQL', () => {
  let db, admin, backupService, scheduler, Client;
  const database = `backup_lock_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-backup-test-'));

  const manualRun = () =>
    backupService.runBackup({ type: 'db_only', triggeredBy: 'manual', scheduleKey: 'manual:db_only' });

  async function insertRunningJob(jobNumber, startedAgo = '0 minutes') {
    await db.query(
      `INSERT INTO backup_jobs (job_number, type, status, triggered_by, started_at)
       VALUES ($1, 'db_only', 'running', 'scheduled', NOW() - $2::interval)`,
      [jobNumber, startedAgo],
    );
  }
  async function jobStatus(jobNumber) {
    const { rows } = await db.query(
      `SELECT status, error_message FROM backup_jobs WHERE job_number = $1`, [jobNumber]);
    return rows[0];
  }
  async function notificationsTitled(pattern) {
    const { rows } = await db.query(`SELECT title FROM notifications WHERE title LIKE $1`, [pattern]);
    return rows;
  }
  // A second session holding the lock stands in for a live backup in
  // another process; ending it simulates that process crashing.
  async function lockHolder() {
    const c = new Client();
    await c.connect();
    await c.query('SELECT pg_advisory_lock($1)', [BACKUP_LOCK_KEY]);
    return c;
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      PGHOST: '127.0.0.1', PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '', PGDATABASE: database,
    });
    ({ Client } = require('pg'));
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();

    const dbBackup = require('../../server/backup/strategies/dbBackup');
    dbBackup.backupDatabase = async (out) => {
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      await fs.promises.writeFile(out, 'stub dump');
      return { path: out, sizeBytes: 9 };
    };
    backupService = require('../../server/backup/backupService');
    scheduler = require('../../server/backup/scheduler');
    await backupService.loadSettings();
    await db.query(
      `UPDATE backup_settings SET local_enabled = true, local_path = $1, nas_enabled = false,
              usb_enabled = false, notify_on_failure = true, notify_on_success = false`,
      [backupDir],
    );
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it('fails an orphaned running job, notifies, and lets the next backup run', async () => {
    await insertRunningJob('BKP-ORPHAN-1');

    const result = await manualRun();
    expect(result.status).toBe('completed');

    expect(await jobStatus('BKP-ORPHAN-1')).toMatchObject({
      status: 'failed',
      error_message: expect.stringMatching(/^Interrupted/),
    });
    expect(await notificationsTitled('%BKP-ORPHAN-1%')).toHaveLength(1);
  });

  it('refuses while a live backup holds the lock, without touching its row', async () => {
    const holder = await lockHolder();
    try {
      await insertRunningJob('BKP-LIVE-1');
      expect(await backupService.isBackupRunning()).toBe(true);
      await expect(manualRun()).rejects.toMatchObject({
        code: 'BIZ_BACKUP_IN_PROGRESS',
        runningJob: expect.objectContaining({ job_number: 'BKP-LIVE-1' }),
      });
      expect((await jobStatus('BKP-LIVE-1')).status).toBe('running');
    } finally {
      await holder.end();
    }
  });

  it('a backup process that dies mid-run does not block later backups', async () => {
    // The holder above disconnected — Postgres released its lock.
    expect(await backupService.isBackupRunning()).toBe(false);
    expect((await jobStatus('BKP-LIVE-1')).status).toBe('failed');
    const result = await manualRun();
    expect(result.status).toBe('completed');
  });

  it('scheduler flags a backup holding the lock for hours, once', async () => {
    const holder = await lockHolder();
    try {
      await insertRunningJob('BKP-STUCK-1', '4 hours');
      await scheduler.safeRun('nightly full', 'nightly', 'full', null);
      await scheduler.safeRun('nightly full', 'nightly', 'full', null);
      expect(await notificationsTitled('%BKP-STUCK-1 appears stuck%')).toHaveLength(1);
    } finally {
      await holder.end();
    }
  });

  it('scheduler notifies Admins when a run fails before a job exists', async () => {
    const original = backupService.runBackup;
    backupService.runBackup = async () => { throw new Error('settings table unreadable'); };
    try {
      await scheduler.safeRun('6h DB', '6h', 'db_only', null);
    } finally {
      backupService.runBackup = original;
    }
    expect(await notificationsTitled('Scheduled 6h DB backup could not start')).toHaveLength(1);
  });
});
