import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

// The Error logs page loads one page of rows (5 by default, 50 at most) and
// pages through the rest with the severity and resolved filters applied.
// Creates and drops its own database on an explicitly selected test server.
describe.skipIf(!enabled)('error log paging on real PostgreSQL', () => {
  let admin, db, app, request;
  const database = `error_logs_paging_${randomUUID().replaceAll('-', '')}`;
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
    await db.query('DELETE FROM error_logs');
    // 60 unresolved warnings, 7 resolved warnings, 3 unresolved criticals,
    // one second apart so the newest-first order is fixed.
    await db.query(`
      INSERT INTO error_logs (code, message, severity, resolved, created_at)
      SELECT 'VALIDATION_FAILED', 'warning ' || g, 'warning', false, NOW() - (g || ' seconds')::interval
        FROM generate_series(1, 60) g
      UNION ALL
      SELECT 'VALIDATION_FAILED', 'resolved ' || g, 'warning', true, NOW() - ((100 + g) || ' seconds')::interval
        FROM generate_series(1, 7) g
      UNION ALL
      SELECT 'DB_QUERY_FAILED', 'critical ' || g, 'critical', false, NOW() - ((200 + g) || ' seconds')::interval
        FROM generate_series(1, 3) g`);
    const ctrl = require('../../server/controllers/errorLogsController');
    const express = require('express');
    request = require('supertest');
    app = express();
    app.get('/error-logs', ctrl.list);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('returns 5 rows and the full total by default', async () => {
    const res = await request(app).get('/error-logs').expect(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.pagination).toEqual({ page: 1, limit: 5, total: 70, pages: 14 });
    expect(res.body.data.map((r) => r.message)).toEqual([1, 2, 3, 4, 5].map((n) => `warning ${n}`));
  });

  it('never returns more than 50 rows', async () => {
    const res = await request(app).get('/error-logs?limit=500').expect(200);
    expect(res.body.data).toHaveLength(50);
    expect(res.body.meta.pagination).toMatchObject({ limit: 50, total: 70, pages: 2 });
  });

  it('pages through the filtered rows without gaps or repeats', async () => {
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await request(app)
        .get(`/error-logs?severity=warning&resolved=false&limit=25&page=${page}`)
        .expect(200);
      expect(res.body.meta.pagination).toMatchObject({ page, limit: 25, total: 60, pages: 3 });
      seen.push(...res.body.data.map((r) => r.message));
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen.every((m) => m.startsWith('warning '))).toBe(true);
  });

  it('returns an empty page past the end with the total intact', async () => {
    const res = await request(app).get('/error-logs?resolved=true&limit=5&page=9').expect(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.pagination).toMatchObject({ total: 7, pages: 2 });
  });

  it('keeps the summary cards on the whole table, not the page', async () => {
    const res = await request(app).get('/error-logs?limit=5').expect(200);
    expect(res.body.meta.summary).toMatchObject({ critical_7d: 3, warning_7d: 67, unresolved: 63 });
  });
});
