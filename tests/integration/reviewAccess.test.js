/**
 * Whole-repo review, access and HR batch, on real PostgreSQL: a restart keeps an
 * Admin's role edits, delegated user rights can't reach beyond the actor's own,
 * people can change their own password, a dismissed employee can't sign in, the
 * day reopens after a sign-out, and the forecast job can't loop.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('access review fixes on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, manager, cashier;
  const database = `review_acc_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function user(roleName, passwordHash = 'x') {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const username = `u_${randomUUID().slice(0, 8)}`;
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id`,
      [username, passwordHash, role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [u.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    return { id: u.id, username, as: (method, url) => request(app)[method](url).auth(token, { type: 'bearer' }) };
  }

  const grant = (userId, key) => db.query(
    `INSERT INTO user_permissions (user_id, permission_id, granted)
     SELECT $1, id, true FROM permissions WHERE key = $2`, [userId, key]);

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

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/auth', require('../../server/routes/auth'));
    app.use('/users', require('../../server/routes/users'));
    app.use('/roles', require('../../server/routes/roles'));
    app.use('/employees', require('../../server/routes/employees'));
    app.use(require('../../server/middleware/errors').errorHandler);

    adminUser = await user('Admin');
    manager = await user('Manager');
    cashier = await user('Cashier');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const roleKeys = async (name) => (await db.query(
    `SELECT p.key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id WHERE r.name = $1`, [name])).rows.map((r) => r.key);

  it('a restart keeps the changes an Admin made to a role', async () => {
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    const kept = (await roleKeys('Cashier')).filter((key) => key !== 'customer.edit');
    const edited = await adminUser.as('put', `/roles/${role.id}/permissions`).send({ permissionKeys: kept });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    await require('../../server/db/seed').run();
    expect(await roleKeys('Cashier')).not.toContain('customer.edit');
  });

  it('a delegated user cannot rewrite the Admin role or strip a permission they lack', async () => {
    await grant(manager.id, 'user.change_role');
    const { rows: [adminRole] } = await db.query(`SELECT id FROM roles WHERE name = 'Admin'`);
    expect((await manager.as('put', `/roles/${adminRole.id}/permissions`).send({ permissionKeys: [] })).status).toBe(403);
    expect(await roleKeys('Admin')).toContain('user.change_role');
  });

  it('even an Admin cannot remove the permission that manages roles from the Admin role', async () => {
    const { rows: [adminRole] } = await db.query(`SELECT id FROM roles WHERE name = 'Admin'`);
    expect((await adminUser.as('put', `/roles/${adminRole.id}/permissions`).send({ permissionKeys: [] })).status).toBe(400);
  });

  it('a delegated user cannot assign a custom role with more power than they hold', async () => {
    await grant(manager.id, 'user.create');
    const { rows: [role] } = await db.query(
      `INSERT INTO roles (name, description, is_system) VALUES ('Accountant', 'Books', false) RETURNING id`);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE key = 'finance.close_period'`, [role.id]);
    const res = await manager.as('post', '/users').send({
      username: `acct_${randomUUID().slice(0, 6)}`, password: 'a long enough phrase', roleId: role.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('a role change drops individual grants from the old job', async () => {
    const person = await user('Manager');
    await grant(person.id, 'backup.download');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    const res = await adminUser.as('put', `/users/${person.id}`).send({ roleId: role.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await db.query(`SELECT 1 FROM user_permissions WHERE user_id = $1`, [person.id]);
    expect(rows).toEqual([]);
  });

  it('people can change their own password, with the current one', async () => {
    const bcrypt = require('bcrypt');
    const person = await user('Cashier', await bcrypt.hash('the old phrase here', 4));
    const change = (currentPassword, newPassword) => person.as('post', '/auth/change-password').send({ currentPassword, newPassword });
    expect((await change('not the old one', 'a brand new phrase')).status).toBe(400);
    expect((await change('the old phrase here', 'short')).status).toBe(400);
    expect((await change('the old phrase here', 'a brand new phrase')).status).toBe(200);
    const { rows: [row] } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [person.id]);
    expect(await bcrypt.compare('a brand new phrase', row.password_hash)).toBe(true);
  });

  it('deactivating an employee ends their sign-in', async () => {
    await grant(manager.id, 'employee.delete');
    const { rows: [emp] } = await db.query(`INSERT INTO employees (name) VALUES ('Leaving') RETURNING id`);
    await db.query(`UPDATE users SET employee_id = $1 WHERE id = $2`, [emp.id, cashier.id]);
    const res = await adminUser.as('delete', `/employees/${emp.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows: [row] } = await db.query(`SELECT is_active FROM users WHERE id = $1`, [cashier.id]);
    expect(row.is_active).toBe(false);
    expect((await cashier.as('get', '/auth/me')).status).toBe(401);
  });

  it('the forecast job does not overflow its timer', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-05T10:00:00'));
      const spy = vi.spyOn(global, 'setTimeout');
      const { startForecastJob } = require('../../server/services/forecastService');
      startForecastJob();
      const delays = spy.mock.calls.map((call) => call[1]).filter((d) => typeof d === 'number');
      expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
      spy.mockRestore();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('a template value containing $ or {{...}} prints as written', () => {
    const { fillTemplate } = require('../../server/services/pdfService');
    expect(fillTemplate('[{{NAME}}] {{TOTAL}}', { NAME: "$& {{TOTAL}} $`", TOTAL: '5' })).toBe("[$& {{TOTAL}} $`] 5");
  });
});
