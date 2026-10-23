/**
 * Phone numbers are saved in international form now (+971…), while older
 * customers may be stored as 050… or 00971…. The duplicate check and the
 * customer searches must treat every spelling as the same number.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('customer phone matching on real PostgreSQL', () => {
  let db, admin, app, request, token;
  const database = `customer_phone_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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
    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [u.id, auth.hashToken(token)]);
    // An older customer saved the local way.
    await db.query(`INSERT INTO customers (name, phone) VALUES ('Old Local', '050 123 4567'), ('Foreign', '+447400123456')`);
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/customers', require('../../server/routes/customers'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const post = (body) => request(app).post('/customers').auth(token, { type: 'bearer' }).send(body);
  const search = async (q) => (await request(app).get(`/customers/search?q=${encodeURIComponent(q)}`).auth(token, { type: 'bearer' })).body.data.map((c) => c.name);
  const list = async (q) => (await request(app).get(`/customers?search=${encodeURIComponent(q)}`).auth(token, { type: 'bearer' })).body.data.map((c) => c.name);

  it('refuses the same number in international form', async () => {
    const res = await post({ name: 'Duplicate', phone: '+971501234567' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VAL_DUPLICATE_PHONE');
  });

  it('refuses it as 00971 too, but allows a different number', async () => {
    expect((await post({ name: 'Dup 2', phone: '00971 50 123 4567' })).status).toBe(409);
    expect((await post({ name: 'New One', phone: '+971501234568' })).status).toBe(201);
  });

  it('does not confuse numbers from different countries that share digits', async () => {
    expect((await post({ name: 'UAE 7400', phone: '+971 74 001 2345' })).status).toBe(201);
  });

  it('finds the old local number when searching the new way, and back', async () => {
    expect(await search('+971 50 123 4567')).toContain('Old Local');
    expect(await search('0501234')).toContain('Old Local');
    expect(await search('050123456')).toEqual(expect.arrayContaining(['Old Local', 'New One']));
    expect(await list('+97150123')).toContain('Old Local');
    expect(await list('0501234568')).toContain('New One');
  });

  it('still finds by name', async () => {
    expect(await search('Foreign')).toContain('Foreign');
  });
});
