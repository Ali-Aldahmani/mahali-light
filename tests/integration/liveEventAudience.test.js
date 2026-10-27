/**
 * Round 2, Phase 2 (authentication audit AUTH-04): live events follow each
 * user's effective permissions, the same set the REST routes check.
 *
 * Runs a real HTTP + Socket.IO server against its own database:
 * - a user-level deny stops a role's events (Manager denied cash.view)
 * - a custom role granted a permission gets that permission's events
 * - roles without the permission get nothing (Warehouse and cash)
 * - stock_updated reaches the till (product.view) and the store room
 *   (stock.view), not a user denied both
 * - an edit decision reaches approvers and the cashier who asked, once
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('live event audience on real PostgreSQL', () => {
  let db, admin, server, baseUrl, io, ioClient;
  const database = `live_events_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const sockets = [];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(check, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (check()) return true;
      await wait(25);
    }
    return false;
  }
  const got = (s, event) => s.events.filter((e) => e.event === event);

  function connect(token) {
    return new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      sockets.push(s);
    });
  }

  async function permissionId(key) {
    return (await db.query(`SELECT id FROM permissions WHERE key = $1`, [key])).rows[0].id;
  }

  // A signed-in user with an open session, and a connected socket.
  async function userSocket(roleName, { deny = [] } = {}) {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'unused', $2) RETURNING id`,
      [`u_${randomUUID().slice(0, 8)}`, role.id]);
    for (const key of deny) {
      await db.query(`INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, false)`,
        [user.id, await permissionId(key)]);
    }
    const token = auth.signToken({ sub: user.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [user.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    const socket = await connect(token);
    socket.userId = user.id;
    socket.token = token;
    return socket;
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
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();
    await require('../../server/services/journalService').ensurePeriodsForDate(
      require('../../server/utils/dates').todayStoreDate(),
    );

    // A custom role that may only look at the cash drawer.
    const { rows: [role] } = await db.query(`INSERT INTO roles (name) VALUES ('Auditor') RETURNING id`);
    await db.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [role.id, await permissionId('cash.view')]);

    const express = require('express');
    const http = require('node:http');
    ({ io: ioClient } = require('socket.io-client'));
    const app = express();
    app.use(express.json());
    server = http.createServer(app);
    io = require('../../server/socket').attachSocket(server);
    app.set('io', io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 30000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('cash events follow cash.view, including user denies and custom roles', async () => {
    const manager = await userSocket('Manager');
    const deniedManager = await userSocket('Manager', { deny: ['cash.view'] });
    const auditor = await userSocket('Auditor');
    const warehouse = await userSocket('Warehouse');
    const adminUser = await userSocket('Admin');

    await require('../../server/services/cashService').openDrawer({
      openingBalance: 150, employeeId: manager.userId, io,
    });

    for (const s of [manager, auditor, adminUser]) {
      expect(await until(() => got(s, 'drawer_opened').length === 1)).toBe(true);
      expect(got(s, 'cash_balance_updated')).toHaveLength(1);
    }
    await wait(150);
    for (const s of [deniedManager, warehouse]) {
      expect(got(s, 'drawer_opened')).toHaveLength(0);
      expect(got(s, 'cash_balance_updated')).toHaveLength(0);
    }
  });

  it('stock_updated reaches the till and the store room, not a user denied both', async () => {
    const cashier = await userSocket('Cashier');
    const warehouse = await userSocket('Warehouse');
    const blind = await userSocket('Cashier', { deny: ['product.view'] });
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Live item') RETURNING id`);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 10, 4, 5) RETURNING id`, [p.id, randomUUID()]);

    await require('../../server/services/stockService').applyStockMovement({
      variantId: v.id, type: 'adjustment', quantity: 1, employeeId: null, notes: 'Live test', io,
    });

    expect(await until(() => got(cashier, 'stock_updated').length === 1)).toBe(true);
    expect(await until(() => got(warehouse, 'stock_updated').length === 1)).toBe(true);
    await wait(150);
    expect(got(blind, 'stock_updated')).toHaveLength(0);
  });

  it('an edit decision reaches approvers and the requester once, not other cashiers', async () => {
    const requester = await userSocket('Cashier');
    const otherCashier = await userSocket('Cashier');
    const manager = await userSocket('Manager');
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status) VALUES ($1, 'confirmed') RETURNING id`, [randomUUID()]);
    const { rows: [req] } = await db.query(
      `INSERT INTO invoice_edit_requests (invoice_id, requested_by, request_note, changes)
       VALUES ($1, $2, 'Fix a line', '{}') RETURNING id`, [inv.id, requester.userId]);

    await require('../../server/services/invoiceService').rejectEditRequest({
      requestId: req.id, managerId: manager.userId, reason: 'Not needed', io,
    });

    expect(await until(() => got(requester, 'edit_request_reviewed').length === 1)).toBe(true);
    expect(await until(() => got(manager, 'edit_request_reviewed').length === 1)).toBe(true);
    await wait(150);
    expect(got(requester, 'edit_request_reviewed')).toHaveLength(1);
    expect(got(otherCashier, 'edit_request_reviewed')).toHaveLength(0);
  });

  it('a permission change takes effect when the socket reconnects', async () => {
    const manager = await userSocket('Manager');
    const other = await userSocket('Manager');
    await db.query(`INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, false)`,
      [manager.userId, await permissionId('bank.view')]);
    // What the permissions screen does after saving: drop the user's sockets.
    require('../../server/services/presenceService').refreshUserSockets(io, manager.userId);
    expect(await until(() => !manager.connected)).toBe(true);
    const reconnected = await connect(manager.token);

    require('../../server/socket/events').emitEvent(io, 'bank_balance_updated', { bankAccountId: null, newBalance: 0 });
    expect(await until(() => got(other, 'bank_balance_updated').length === 1)).toBe(true);
    await wait(150);
    expect(got(reconnected, 'bank_balance_updated')).toHaveLength(0);
  });
});
