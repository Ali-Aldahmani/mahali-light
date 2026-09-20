/**
 * Route-level RBAC regression tests.
 *
 * tests/contracts/authz.contract.test.js and authzPolicy.test.js already
 * prove the permission-checking logic is correct in isolation (call
 * requirePermission()/assertCanManageTarget() directly with a mock req).
 * What's missing (audit finding OPS-403) is proof that the REAL route
 * stack — Express router -> requireAuth -> requirePermission -> controller
 * -> shared/authzPolicy — actually returns a 403 over real HTTP for a real
 * low-privilege JWT, which is the only way a route that forgot to wire in
 * requirePermission would ever get caught.
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, mirroring tests/integration/invoiceIntegrity.test.js. No
 * production credentials or database names are loaded from .env.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('route-level RBAC on real PostgreSQL', () => {
  let db, auth, app, request;
  let adminToken, managerToken, cashierToken, adminId, managerId, cashierId;
  let cashier2Token;
  const database = `rbac_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let admin;

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
    await require('../../server/db/seed').run(); // real roles, real permissions, real Admin user

    auth = require('../../server/middleware/auth');

    async function makeUser(username, roleName) {
      const { rows: roleRows } = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ($1,'unused',$2,true) RETURNING id`,
        [username, roleRows[0].id],
      );
      const id = rows[0].id;
      const token = auth.signToken({ sub: id });
      await db.query(
        `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
        [id, auth.hashToken(token)],
      );
      return { id, token };
    }

    const { rows: seededAdmin } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin[0].id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );

    ({ id: managerId, token: managerToken } = await makeUser('manager1', 'Manager'));
    ({ id: cashierId, token: cashierToken } = await makeUser('cashier1', 'Cashier'));
    // Separate from cashierToken above: that session gets force-logged-out
    // by another test in this file, which would otherwise make a later
    // request with it fail auth (401) before it ever reaches the
    // authorization check this test wants to prove (403) — session state
    // shouldn't leak between independent test cases.
    ({ token: cashier2Token } = await makeUser('cashier2', 'Cashier'));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/users', require('../../server/routes/users'));
    app.use('/roles', require('../../server/routes/roles'));
    app.use((err, _req, res, _next) => res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('Cashier gets a real 403 from POST /users (no user.create)', async () => {
    const res = await request(app)
      .post('/users')
      .auth(cashierToken, { type: 'bearer' })
      .send({ username: 'nope', password: 'whatever', roleId: null });
    expect(res.status).toBe(403);
  });

  it('Manager gets a real 403 force-logging-out the Admin (hierarchy check)', async () => {
    const res = await request(app)
      .post(`/users/${adminId}/force-logout`)
      .auth(managerToken, { type: 'bearer' })
      .send({});
    expect(res.status).toBe(403);
    // The Admin's session must still be open - the Manager's request never
    // reached the point of closing it.
    const { rows } = await db.query(
      'SELECT logout_at FROM user_sessions WHERE user_id = $1 ORDER BY login_at DESC LIMIT 1',
      [adminId],
    );
    expect(rows[0].logout_at).toBeNull();
  });

  it('Manager can force-logout the lower-ranked Cashier', async () => {
    const res = await request(app)
      .post(`/users/${cashierId}/force-logout`)
      .auth(managerToken, { type: 'bearer' })
      .send({});
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      'SELECT logout_at FROM user_sessions WHERE user_id = $1 ORDER BY login_at DESC LIMIT 1',
      [cashierId],
    );
    expect(rows[0].logout_at).not.toBeNull();
  });

  it('Admin can force-logout anyone, including another Admin', async () => {
    const res = await request(app)
      .post(`/users/${managerId}/force-logout`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(res.status).toBe(200);
  });

  it('a custom role cannot be renamed to a reserved system name ("Admin")', async () => {
    const created = await request(app)
      .post('/roles')
      .auth(adminToken, { type: 'bearer' })
      .send({ name: `TempRole-${randomUUID().slice(0, 8)}` });
    expect(created.status).toBe(201);

    const renamed = await request(app)
      .put(`/roles/${created.body.data.id}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ name: 'Admin' });
    expect(renamed.status).toBe(400);
  });

  it('Cashier gets a real 403 creating a role (no user.change_role)', async () => {
    const res = await request(app)
      .post('/roles')
      .auth(cashier2Token, { type: 'bearer' })
      .send({ name: `ShouldFail-${randomUUID().slice(0, 8)}` });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated request is rejected before reaching any controller', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });
});
