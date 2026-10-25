/**
 * Warranty claims can't hand out a unit twice (warranty audit F16/F17/F18).
 *
 * - one open claim per warranty; a replaced warranty can't be claimed again
 * - resolution rechecks the warranty: refunded/voided coverage can't be
 *   replaced or repaired, only rejected
 * - a replacement must be a variant of the same product, and its serial is
 *   recorded on the replacement invoice line and the new warranty
 * - claim edits can't reopen a resolved claim
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('warranty claims on real PostgreSQL', () => {
  let db, admin, warranties, userId, app, request, token;
  const database = `warranty_claims_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function product() {
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Fan') RETURNING id`);
    const variant = async () => (await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, 40, 5) RETURNING id`, [p.id, randomUUID()])).rows[0].id;
    return { productId: p.id, variantId: await variant(), otherVariantId: await variant() };
  }
  async function warranty({ productId, variantId, status = 'active', startDaysAgo = 1, customerId = null }) {
    return (await db.query(
      `INSERT INTO warranties (warranty_number, product_id, variant_id, customer_id, status,
                               start_date, end_date, duration_months)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - $6::int, CURRENT_DATE + 300, 12) RETURNING id`,
      [`W-${randomUUID()}`, productId, variantId, customerId, status, startDaysAgo])).rows[0].id;
  }
  const claim = (warrantyId, extra = {}) =>
    warranties.createClaim({ warrantyId, issueDescription: 'Stopped working', createdBy: userId, ...extra });

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
    warranties = require('../../server/services/warrantyService');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));

    const auth = require('../../server/middleware/auth');
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/warranty-claims', require('../../server/routes/warrantyClaims'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('allows one open claim per warranty, and none on a warranty already replaced', async () => {
    const p = await product();
    const w = await warranty(p);
    const first = await claim(w);
    await expect(claim(w)).rejects.toMatchObject({ status: 409 });

    await warranties.resolveWarrantyClaim({
      claimId: first.claim?.id || first.id, resolution: 'replaced', managerId: userId, pcIdentifier: 'T',
    });
    const { rows: [after] } = await db.query(`SELECT status FROM warranties WHERE id = $1`, [w]);
    expect(after.status).toBe('claimed');
    await expect(claim(w)).rejects.toMatchObject({ status: 409 });
  });

  it('the database also refuses a second open claim', async () => {
    const p = await product();
    const w = await warranty(p);
    await claim(w);
    await expect(db.query(
      `INSERT INTO warranty_claims (claim_number, warranty_id, issue_description, status)
       VALUES ($1, $2, 'dup', 'open')`, [`C-${randomUUID()}`, w])).rejects.toThrow(/uq_warranty_claims_one_open/);
  });

  it('refuses a claim before the warranty starts and for another customer', async () => {
    const p = await product();
    const future = await warranty({ ...p, startDaysAgo: -5 });
    await expect(claim(future)).rejects.toMatchObject({ status: 409 });

    const { rows: [c1] } = await db.query(`INSERT INTO customers (name) VALUES ('Owner') RETURNING id`);
    const { rows: [c2] } = await db.query(`INSERT INTO customers (name) VALUES ('Someone else') RETURNING id`);
    const owned = await warranty({ ...p, customerId: c1.id });
    await expect(claim(owned, { customerId: c2.id })).rejects.toMatchObject({ status: 400 });
  });

  it('a claim whose warranty was voided after filing can only be rejected', async () => {
    const p = await product();
    const w = await warranty(p);
    const c = await claim(w);
    const claimId = c.claim?.id || c.id;
    await db.query(`UPDATE warranties SET status = 'void' WHERE id = $1`, [w]);
    const stockBefore = Number((await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [p.variantId])).rows[0].stock_qty);

    await expect(warranties.resolveWarrantyClaim({ claimId, resolution: 'replaced', managerId: userId }))
      .rejects.toMatchObject({ status: 409 });
    await expect(warranties.resolveWarrantyClaim({ claimId, resolution: 'repaired', managerId: userId }))
      .rejects.toMatchObject({ status: 409 });
    expect(Number((await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [p.variantId])).rows[0].stock_qty))
      .toBe(stockBefore);
    await warranties.resolveWarrantyClaim({ claimId, resolution: 'rejected', notes: 'Refunded', managerId: userId });
  });

  it('a replacement must be the same product, and its serial is recorded', async () => {
    const p = await product();
    const other = await product();
    const w = await warranty(p);
    const c = await claim(w);
    const claimId = c.claim?.id || c.id;

    await expect(warranties.resolveWarrantyClaim({
      claimId, resolution: 'replaced', replacementVariantId: other.variantId, managerId: userId,
    })).rejects.toMatchObject({ status: 400 });

    const result = await warranties.resolveWarrantyClaim({
      claimId, resolution: 'replaced', replacementVariantId: p.otherVariantId,
      replacementSerial: 'SN-REPL-1', managerId: userId, pcIdentifier: 'T',
    });
    const { rows: [line] } = await db.query(
      `SELECT ii.serial_number, ii.product_id FROM invoice_items ii
         JOIN warranty_claims c ON c.replacement_invoice_id = ii.invoice_id WHERE c.id = $1`, [claimId]);
    expect(line).toMatchObject({ serial_number: 'SN-REPL-1', product_id: p.productId });
    const { rows: [fresh] } = await db.query(
      `SELECT serial_number, variant_id FROM warranties WHERE invoice_item_id IS NOT NULL
         AND invoice_id = (SELECT replacement_invoice_id FROM warranty_claims WHERE id = $1)`, [claimId]);
    expect(fresh).toMatchObject({ serial_number: 'SN-REPL-1', variant_id: p.otherVariantId });
    expect(result).toBeTruthy();
  });

  it('an edit cannot reopen a resolved claim', async () => {
    const p = await product();
    const w = await warranty(p);
    const c = await claim(w);
    const claimId = c.claim?.id || c.id;
    await warranties.resolveWarrantyClaim({ claimId, resolution: 'repaired', managerId: userId });
    const res = await request(app).put(`/warranty-claims/${claimId}`).auth(token, { type: 'bearer' })
      .send({ status: 'in_progress' });
    expect(res.status).toBe(409);
    const { rows: [after] } = await db.query(`SELECT status FROM warranty_claims WHERE id = $1`, [claimId]);
    expect(after.status).toBe('resolved');
  });
});
