/**
 * First-run setup code regression test.
 *
 * GET /api/setup/status used to hand the setup token to any caller, and
 * POST /api/setup/complete (which creates the Admin) only asked for that
 * token — so any device on the LAN could claim the store before the owner
 * finished setup, and every status call rotated the real wizard's token.
 * The code is now printed to the server log / setup-code.txt only, never
 * returned over HTTP, never rotated while live, and guesses are limited.
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

describe.skipIf(!enabled)('first-run setup code on real PostgreSQL', () => {
  let db, admin, app, request, tokens;
  const database = `setup_code_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-setup-code-'));
  const codeFile = path.join(dir, 'setup-code.txt');
  let code;

  const body = {
    store: { store_name: 'Shop', store_address: '1 Street', store_phone: '0500000000' },
    vat: { vat_enabled: true, vat_rate: 5 },
    network: { mode: 'server' },
  };
  const hash = async () =>
    (await db.query(`SELECT setup_token_hash FROM app_settings ORDER BY updated_at DESC LIMIT 1`)).rows[0].setup_token_hash;

  beforeAll(async () => {
    process.env.SETUP_CODE_FILE = codeFile;
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
    await require('../../server/db/seed').run(); // dev seed creates an Admin
    tokens = require('../../server/services/setupTokenService');

    const express = require('express');
    const { setupLimiter } = require('../../server/middleware/rateLimiter');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/setup/verify-code', setupLimiter);
    app.use('/setup/complete', setupLimiter);
    app.use('/setup', require('../../server/routes/setup'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || 500).json({ code: err.code, message: err.message, details: err.details }));
  }, 30000);

  afterAll(async () => {
    delete process.env.SETUP_CODE_FILE;
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('issues a code at boot into the server log file only', async () => {
    code = await tokens.issueSetupTokenAtBoot();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(fs.readFileSync(codeFile, 'utf8').trim()).toBe(code);
  });

  it('never returns the code from /status, and does not rotate a live one', async () => {
    const before = await hash();
    const res = await request(app).get('/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('setup_token');
    expect(res.body.data.setup_code_required).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(code);
    await request(app).get('/setup/status');
    expect(await hash()).toBe(before);
  });

  it('rejects a wrong code and accepts the real one however it is typed', async () => {
    const wrong = await request(app).post('/setup/verify-code').send({ code: 'AAAA-BBBB-CCCC-DDDD' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.details.reason).toBe('invalid_setup_token');

    const typed = code.replaceAll('-', '').toLowerCase();
    const right = await request(app).post('/setup/verify-code').send({ code: typed });
    expect(right.status).toBe(200);
  });

  it('refuses /complete without the code, as the LAN attacker would call it', async () => {
    const res = await request(app).post('/setup/complete').send(body);
    expect(res.status).toBe(403);
    expect(res.body.details.reason).toBe('missing_setup_token');
  });

  it('replaces an expired code without revealing it', async () => {
    await db.query(`UPDATE app_settings SET setup_token_issued_at = NOW() - INTERVAL '25 hours'`);
    const expired = await request(app).post('/setup/verify-code').send({ code });
    expect(expired.status).toBe(403);
    expect(expired.body.details.reason).toBe('setup_token_expired');

    const res = await request(app).get('/setup/status'); // issues a new one
    const fresh = fs.readFileSync(codeFile, 'utf8').trim();
    expect(fresh).not.toBe(code);
    expect(JSON.stringify(res.body)).not.toContain(fresh);
    code = fresh;
  });

  it('completes setup with the code, then removes the code file', async () => {
    const res = await request(app).post('/setup/complete').set('X-Setup-Token', code).send(body);
    expect(res.status).toBe(201);
    expect(fs.existsSync(codeFile)).toBe(false);
    const status = await request(app).get('/setup/status');
    expect(status.body.data.setup_completed).toBe(true);
    const again = await request(app).post('/setup/complete').set('X-Setup-Token', code).send(body);
    expect(again.status).toBe(409);
  });

  it('rate-limits code guessing', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await request(app).post('/setup/verify-code').send({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })).status);
    }
    expect(statuses).toContain(429);
  });
});
