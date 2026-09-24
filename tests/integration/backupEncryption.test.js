/**
 * Backup encryption regression test.
 *
 * backup_settings.encryption_enabled was saved but never read: archives
 * holding the full database went to local disk / NAS / USB in plaintext.
 * With encryption on, only an encrypted archive may leave the temp dir, and
 * restore must decrypt it (and fail safely on a wrong key — before users
 * are kicked into maintenance mode).
 *
 * pg_dump / pg_restore are stubbed; the local destination is a temp dir.
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
const DUMP_MARKER = 'STUB-PG-DUMP-password_hash-customers-invoices';

describe.skipIf(!enabled)('encrypted backups on real PostgreSQL', () => {
  let db, admin, backupService, maintenanceMode, tar;
  const database = `backup_encryption_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-backup-enc-'));
  const savedSecret = process.env.MAHALI_BACKUP_SECRET;
  let restoredDump = null;

  const manualRun = () =>
    backupService.runBackup({ type: 'db_only', triggeredBy: 'manual', scheduleKey: 'manual:db_only' });
  const jobRow = async (jobId) =>
    (await db.query(`SELECT status, local_file_path, error_message FROM backup_jobs WHERE id = $1`, [jobId])).rows[0];

  beforeAll(async () => {
    process.env.MAHALI_BACKUP_SECRET = 'integration-test-backup-secret-abcdef0123456789';
    Object.assign(process.env, {
      PGHOST: '127.0.0.1', PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '', PGDATABASE: database,
    });
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();
    tar = require('tar');

    const dbBackup = require('../../server/backup/strategies/dbBackup');
    dbBackup.backupDatabase = async (out) => {
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      await fs.promises.writeFile(out, DUMP_MARKER);
      return { path: out, sizeBytes: DUMP_MARKER.length };
    };
    dbBackup.restoreDatabase = async (dumpPath) => {
      restoredDump = await fs.promises.readFile(dumpPath, 'utf8');
      return { success: true };
    };
    backupService = require('../../server/backup/backupService');
    maintenanceMode = require('../../server/backup/maintenanceMode');
    await backupService.loadSettings();
    await db.query(
      `UPDATE backup_settings SET local_enabled = true, local_path = $1, nas_enabled = false,
              usb_enabled = false, encryption_enabled = true`,
      [backupDir],
    );
  }, 30000);

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.MAHALI_BACKUP_SECRET;
    else process.env.MAHALI_BACKUP_SECRET = savedSecret;
    maintenanceMode.disable();
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  let encryptedJobId;

  it('writes only an encrypted archive to the destination', async () => {
    const { jobId, status } = await manualRun();
    expect(status).toBe('completed');
    encryptedJobId = jobId;
    const { local_file_path: file } = await jobRow(jobId);
    expect(file).toMatch(/\.tar\.gz\.enc$/);
    expect(fs.readFileSync(file).includes(Buffer.from(DUMP_MARKER))).toBe(false);

    // Nothing but the .enc lands anywhere under the destination.
    const written = fs.readdirSync(backupDir, { recursive: true }).filter((f) => /\.(gz|enc)$/.test(f));
    expect(written.every((f) => f.endsWith('.enc'))).toBe(true);
  });

  it('restores an encrypted archive', async () => {
    restoredDump = null;
    await backupService.restoreFromBackup({ jobId: encryptedJobId, userId: null, confirmDelaySeconds: 0 });
    expect(restoredDump).toBe(DUMP_MARKER);
    maintenanceMode.disable();
  });

  it('refuses a wrong key before entering maintenance mode', async () => {
    process.env.MAHALI_BACKUP_SECRET = 'not-the-secret-this-archive-used-0000';
    try {
      restoredDump = null;
      await expect(
        backupService.restoreFromBackup({ jobId: encryptedJobId, userId: null, confirmDelaySeconds: 0 }),
      ).rejects.toMatchObject({ code: 'BIZ_BACKUP_DECRYPT_FAILED' });
      expect(restoredDump).toBeNull();
      expect(maintenanceMode.isActive()).toBe(false);
    } finally {
      process.env.MAHALI_BACKUP_SECRET = 'integration-test-backup-secret-abcdef0123456789';
    }
  });

  it('still restores plaintext archives made before encryption was enabled', async () => {
    await db.query(`UPDATE backup_settings SET encryption_enabled = false`);
    const { jobId } = await manualRun();
    const { local_file_path: file } = await jobRow(jobId);
    expect(file).toMatch(/\.tar\.gz$/);
    const entries = [];
    await tar.t({ file, onReadEntry: (e) => entries.push(e.path) });
    expect(entries.some((p) => p.endsWith('-db.dump'))).toBe(true);

    restoredDump = null;
    await backupService.restoreFromBackup({ jobId, userId: null, confirmDelaySeconds: 0 });
    expect(restoredDump).toBe(DUMP_MARKER);
    maintenanceMode.disable();
    await db.query(`UPDATE backup_settings SET encryption_enabled = true`);
  });

  it('fails the job loudly, not in plaintext, when the secret is missing', async () => {
    delete process.env.MAHALI_BACKUP_SECRET;
    try {
      await expect(manualRun()).rejects.toMatchObject({ code: 'BIZ_BACKUP_ENCRYPTION_KEY_MISSING' });
      const { rows: [job] } = await db.query(
        `SELECT status, local_file_path FROM backup_jobs ORDER BY started_at DESC LIMIT 1`);
      expect(job).toEqual({ status: 'failed', local_file_path: null });
    } finally {
      process.env.MAHALI_BACKUP_SECRET = 'integration-test-backup-secret-abcdef0123456789';
    }
  });
});
