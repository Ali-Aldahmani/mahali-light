/**
 * Upgrading an existing shop to migration 035 (purchase_orders.confirmed_at).
 *
 * Simulates a live install: migrate to the pre-035 schema, add real supplier
 * data, then boot the new version (runMigrations with preMigrationBackup).
 * Checks that:
 *   - a pre-migration DB backup is taken before the schema changes,
 *   - existing POs survive with confirmed_at = NULL,
 *   - supplier lead time starts the clock at confirmed_at when known and
 *     falls back to order_date for older POs,
 *   - nothing is backed up when there is nothing to migrate,
 *   - a failed backup blocks the upgrade instead of migrating unprotected.
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

describe.skipIf(!enabled)('migration 035 upgrade of an existing install on real PostgreSQL', () => {
  let db, admin, runMigrations, dbBackup, app, request, adminToken;
  let supplierId, oldPoId;
  const database = `po_confirmed_at_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-premigrate-'));
  const stubDump = async (out) => {
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, 'stub dump');
    return { path: out, sizeBytes: 9 };
  };

  async function preMigrationJobs() {
    const { rows } = await db.query(
      `SELECT status FROM backup_jobs WHERE triggered_by = 'pre_migration' ORDER BY started_at`,
    );
    return rows;
  }
  async function migrationApplied(file) {
    const { rows } = await db.query(`SELECT 1 FROM _migrations WHERE filename = $1`, [file]);
    return rows.length === 1;
  }

  beforeAll(async () => {
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
    ({ runMigrations } = require('../../server/db/migrate'));

    // The shop as it is today: every migration before 035, with data.
    await runMigrations({ stopBefore: '035_' });
    await require('../../server/db/seed').run();

    dbBackup = require('../../server/backup/strategies/dbBackup');
    dbBackup.backupDatabase = stubDump;
    const backupService = require('../../server/backup/backupService');
    await backupService.loadSettings();
    await db.query(
      `UPDATE backup_settings SET local_enabled = true, local_path = $1, nas_enabled = false,
              usb_enabled = false, encryption_enabled = false,
              notify_on_failure = false, notify_on_success = false`,
      [backupDir],
    );

    const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Falcon') RETURNING id`);
    supplierId = s.id;
    // Ordered 18 days ago, received today, no confirmation time on record.
    const { rows: [po] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, order_date, received_date, status)
       VALUES ('PO-OLD-1', $1, CURRENT_DATE - 18, CURRENT_DATE, 'received') RETURNING id`,
      [supplierId],
    );
    oldPoId = po.id;

    // Boot the new version.
    await runMigrations({ preMigrationBackup: true });

    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = auth.signToken({ sub: u.id });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [u.id, auth.hashToken(adminToken)],
    );
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/suppliers', require('../../server/routes/suppliers'));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it('backs up the database before upgrading it', async () => {
    expect(await preMigrationJobs()).toEqual([{ status: 'completed' }]);
    const files = fs.readdirSync(path.join(backupDir, 'pre-migration'));
    expect(files).toHaveLength(1);
    expect(await migrationApplied('035_po_confirmed_at.sql')).toBe(true);
  });

  it('keeps existing POs, with no guessed confirmation time', async () => {
    const { rows } = await db.query(
      `SELECT po_number, status, confirmed_at FROM purchase_orders WHERE id = $1`, [oldPoId]);
    expect(rows[0]).toEqual({ po_number: 'PO-OLD-1', status: 'received', confirmed_at: null });
  });

  it('measures lead time from confirmation when known, order date otherwise', async () => {
    const leadTime = async () => {
      const res = await request(app).get(`/suppliers/${supplierId}`).auth(adminToken, { type: 'bearer' });
      expect(res.status).toBe(200);
      return res.body.data.avgLeadTimeDays;
    };
    expect(await leadTime()).toBe(18); // old PO falls back to order_date

    // Drafted 20 days ago but only confirmed 4 days ago: really a 4-day delivery.
    await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, order_date, confirmed_at, received_date, status)
       VALUES ('PO-NEW-1', $1, CURRENT_DATE - 20, NOW() - INTERVAL '4 days', CURRENT_DATE, 'received')`,
      [supplierId],
    );
    expect(await leadTime()).toBe(11); // (18 + 4) / 2, not (18 + 20) / 2
  });

  it('takes no backup when there is nothing to migrate', async () => {
    await runMigrations({ preMigrationBackup: true });
    expect(await preMigrationJobs()).toHaveLength(1);
  });

  it('refuses to upgrade when the backup fails', async () => {
    // Make 035 pending again (it is idempotent: ADD COLUMN IF NOT EXISTS).
    await db.query(`DELETE FROM _migrations WHERE filename = '035_po_confirmed_at.sql'`);
    dbBackup.backupDatabase = async () => {
      throw new Error('pg_dump not found');
    };
    try {
      await expect(runMigrations({ preMigrationBackup: true })).rejects.toThrow(/database NOT upgraded/);
      expect(await migrationApplied('035_po_confirmed_at.sql')).toBe(false);
    } finally {
      dbBackup.backupDatabase = stubDump;
    }
    await runMigrations({ preMigrationBackup: true });
    expect(await migrationApplied('035_po_confirmed_at.sql')).toBe(true);
  });
});
