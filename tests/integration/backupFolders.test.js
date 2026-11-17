/**
 * Folder picker for the backup Local path.
 *
 * GET/POST /api/backup/folders show and create folders on the server's disk.
 * Saving a new backup location is Admin-only, so looking around the disk is
 * too: a user granted backup.configure without being an Admin is refused.
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

describe.skipIf(!enabled)('backup folder picker on real PostgreSQL', () => {
  let db, admin, app, request;
  let adminToken, managerToken;
  const database = `backup_folders_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-backup-folders-')));

  beforeAll(async () => {
    fs.mkdirSync(path.join(dir, 'existing'));
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
    const auth = require('../../server/middleware/auth');

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
      `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ('manager_folders','unused',$1,true) RETURNING id`,
      [role.id],
    );
    // Even with backup.configure granted, a non-Admin may not browse the disk.
    await db.query(
      `INSERT INTO user_permissions (user_id, permission_id, granted)
       SELECT $1, id, true FROM permissions WHERE key = 'backup.configure'`,
      [manager.id],
    );
    managerToken = await session(manager.id);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/backup', require('../../server/routes/backup'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lets an Admin list folders on the server', async () => {
    const res = await request(app).get('/backup/folders').query({ path: dir })
      .auth(adminToken, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.data.path).toBe(dir);
    expect(res.body.data.folders.map((f) => f.name)).toEqual(['existing']);
  });

  it('lets an Admin create a folder, and logs it', async () => {
    const res = await request(app).post('/backup/folders')
      .auth(adminToken, { type: 'bearer' })
      .send({ parent: dir, name: 'pos-backups' });
    expect(res.status).toBe(200);
    expect(res.body.data.path).toBe(path.join(dir, 'pos-backups'));
    expect(fs.existsSync(path.join(dir, 'pos-backups'))).toBe(true);
    const { rows } = await db.query(`SELECT 1 FROM activity_log WHERE action = 'backup.folder_created'`);
    expect(rows).toHaveLength(1);
  });

  it('answers a bad folder name or a duplicate with a clear error', async () => {
    const bad = await request(app).post('/backup/folders')
      .auth(adminToken, { type: 'bearer' })
      .send({ parent: dir, name: '../escape' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');

    const dup = await request(app).post('/backup/folders')
      .auth(adminToken, { type: 'bearer' })
      .send({ parent: dir, name: 'existing' });
    expect(dup.status).toBe(409);
  });

  it('refuses a non-Admin even with backup.configure', async () => {
    const list = await request(app).get('/backup/folders').query({ path: dir })
      .auth(managerToken, { type: 'bearer' });
    expect(list.status).toBe(403);
    expect(list.body.code).toBe('AUTH_NO_PERMISSION');

    const create = await request(app).post('/backup/folders')
      .auth(managerToken, { type: 'bearer' })
      .send({ parent: dir, name: 'sneaky' });
    expect(create.status).toBe(403);
    expect(fs.existsSync(path.join(dir, 'sneaky'))).toBe(false);
  });
});
