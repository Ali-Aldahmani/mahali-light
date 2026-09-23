/**
 * Backup download authorization regression test.
 *
 * GET /api/backup/jobs/:id/download only required backup.view, which the
 * Manager role holds by default — so a Manager could download the whole
 * database (password hashes, user permissions, every cost price) even
 * though restore was Admin-only. It now requires backup.download, an
 * Admin-exclusive permission (Admins get it via '*'; only an Admin can
 * delegate it).
 *
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

describe.skipIf(!enabled)('backup download authorization on real PostgreSQL', () => {
  let db, auth, app, request, admin;
  let adminToken, managerToken, managerId, jobId;
  const database = `backup_download_authz_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-backup-dl-'));
  const archive = path.join(dir, 'db-20260923-020000.tar.gz');
  const ARCHIVE_BYTES = Buffer.from('pretend full database dump');

  const get = (p, token) => request(app).get(p).auth(token, { type: 'bearer' });

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
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();
    auth = require('../../server/middleware/auth');

    async function session(id) {
      const token = auth.signToken({ sub: id });
      await db.query(
        `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
        [id, auth.hashToken(token)],
      );
      return token;
    }
    const { rows: [seededAdmin] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = await session(seededAdmin.id);
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Manager'`);
    const { rows: [manager] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ('manager_dl','unused',$1,true) RETURNING id`,
      [role.id],
    );
    managerId = manager.id;
    managerToken = await session(managerId);

    fs.writeFileSync(archive, ARCHIVE_BYTES);
    const { rows: [job] } = await db.query(
      `INSERT INTO backup_jobs (job_number, type, status, triggered_by, local_file_path, completed_at)
       VALUES ('BKP-2026-00001', 'db_only', 'completed', 'scheduled', $1, NOW()) RETURNING id`,
      [archive],
    );
    jobId = job.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/backup', require('../../server/routes/backup'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || 500).json({ code: err.code, details: err.details }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a Manager the archive, while backup.view still lists jobs', async () => {
    const list = await get('/backup/jobs', managerToken);
    expect(list.status).toBe(200);

    const res = await get(`/backup/jobs/${jobId}/download`, managerToken);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'AUTH_NO_PERMISSION', details: { missing: ['backup.download'] } });
  });

  it('lets an Admin download the archive', async () => {
    const res = await get(`/backup/jobs/${jobId}/download`, adminToken)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.equals(ARCHIVE_BYTES)).toBe(true);
  });

  it('an Admin can explicitly delegate it to a specific user', async () => {
    await db.query(
      `INSERT INTO user_permissions (user_id, permission_id, granted)
       SELECT $1, id, true FROM permissions WHERE key = 'backup.download'`,
      [managerId],
    );
    const res = await get(`/backup/jobs/${jobId}/download`, managerToken);
    expect(res.status).toBe(200);
  });

  it('a non-Admin cannot delegate backup.download', () => {
    const { assertCanAssignPermissionKeys, ADMIN_EXCLUSIVE_PERMISSIONS } = require('../../shared/authzPolicy');
    expect(ADMIN_EXCLUSIVE_PERMISSIONS).toContain('backup.download');
    const managerActor = { role: 'Manager', permissions: ['backup.view', 'backup.download'] };
    expect(() => assertCanAssignPermissionKeys({ actor: managerActor, permissionKeys: ['backup.download'] }))
      .toThrow(expect.objectContaining({ code: 'AUTH_NO_PERMISSION' }));
  });
});
