/**
 * Custom / third-party invoice item regression test.
 *
 * Feature: a cashier can add a manual line to a normal invoice for a
 * product that isn't in the shop's own catalog (a third-party item they
 * resell but don't stock). Unlike a catalog line it must:
 *   - skip stock deduction/shortfall checks (there's no variant to draw
 *     down),
 *   - still book its cost as COGS (so gross profit/margin reflects the
 *     real economics of the sale), but credit Accounts Payable (2001)
 *     instead of Inventory (1004) since nothing was ever held in stock,
 *   - be blocked for a user without the `invoice.custom_item` permission.
 *
 * Drives the real HTTP route stack end to end, mirroring
 * tests/integration/refundJournal.test.js and routeAuthorization.test.js.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('custom/third-party invoice items on real PostgreSQL', () => {
  let db, auth, app, request;
  let adminToken, cashierToken, adminId, productId, variantId, customerId;
  const database = `custom_invoice_items_regression_${randomUUID().replaceAll('-', '')}`;
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
    await require('../../server/db/seed').run();

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

    // Cashier: no invoice.custom_item by default (ROLE_DEFAULTS excludes it).
    const cashier = await makeUser('cashier1', 'Cashier');
    cashierToken = cashier.token;

    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Cables') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Test Wire', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-CUSTOM-TEST', 'BC-CUSTOM-TEST', 100, 60, 50, true) RETURNING id`,
      [productId],
    );
    variantId = variant.id;
    const { rows: [customer] } = await db.query(`INSERT INTO customers (name) VALUES ('Test Customer') RETURNING id`);
    customerId = customer.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('rejects a custom item from a user without invoice.custom_item', async () => {
    const res = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({
        customerId,
        items: [
          {
            isCustom: true,
            customDescription: 'Third-party chandelier',
            thirdPartyName: 'Acme Lighting',
            quantity: 1,
            unitPrice: 200,
            customCostPrice: 120,
          },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_NO_PERMISSION');
  });

  it('mixes a catalog item and a custom/third-party item on one invoice with correct stock + journal effects', async () => {
    const { rows: [{ stock_qty: stockBefore }] } = await db.query(
      `SELECT stock_qty FROM product_variants WHERE id = $1`,
      [variantId],
    );

    const createRes = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({
        customerId,
        items: [
          { variantId, quantity: 2 }, // catalog: 2 x 100 = 200
          {
            isCustom: true,
            customDescription: 'Third-party chandelier',
            thirdPartyName: 'Acme Lighting',
            quantity: 1,
            unitPrice: 300,
            customCostPrice: 180,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;

    // Subtotal: 200 + 300 = 500, VAT 5% = 25, total 525.
    expect(createRes.body.data.total).toBe(525);

    const { rows: [customItemRow] } = await db.query(
      `SELECT product_name, third_party_name, is_custom FROM invoice_items
        WHERE invoice_id = $1 AND is_custom = true`,
      [invoiceId],
    );
    expect(customItemRow).toBeTruthy();
    expect(customItemRow.is_custom).toBe(true);
    expect(customItemRow.third_party_name).toBe('Acme Lighting');
    expect(customItemRow.product_name).toBe('Third-party chandelier');

    const payRes = await request(app)
      .post(`/invoices/${invoiceId}/payments`)
      .auth(adminToken, { type: 'bearer' })
      .send({ idempotencyKey: randomUUID(), method: 'cash', amount: 525 });
    expect(payRes.status).toBe(201);

    const confirmRes = await request(app)
      .post(`/invoices/${invoiceId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(confirmRes.status).toBe(200);

    // Stock only deducted for the catalog line — the custom line has no
    // variant to draw down.
    const { rows: [{ stock_qty: stockAfter }] } = await db.query(
      `SELECT stock_qty FROM product_variants WHERE id = $1`,
      [variantId],
    );
    expect(Number(stockBefore) - Number(stockAfter)).toBe(2);

    // Journal: COGS (5001) debited for BOTH lines (120 catalog + 180
    // third-party = 300), Inventory (1004) credited only for the catalog
    // line's cost (120), Accounts Payable (2001) credited for the
    // third-party line's cost (180).
    const { rows: cogsRows } = await db.query(
      `SELECT SUM(jl.debit) AS total FROM journal_lines jl
         JOIN chart_of_accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE a.code = '5001' AND je.reference_type = 'invoice' AND je.reference_id = $1`,
      [invoiceId],
    );
    expect(Number(cogsRows[0].total)).toBe(300);

    const { rows: inventoryRows } = await db.query(
      `SELECT SUM(jl.credit) AS total FROM journal_lines jl
         JOIN chart_of_accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE a.code = '1004' AND je.reference_type = 'invoice' AND je.reference_id = $1`,
      [invoiceId],
    );
    expect(Number(inventoryRows[0].total)).toBe(120);

    const { rows: apRows } = await db.query(
      `SELECT SUM(jl.credit) AS total FROM journal_lines jl
         JOIN chart_of_accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE a.code = '2001' AND je.reference_type = 'invoice' AND je.reference_id = $1`,
      [invoiceId],
    );
    expect(Number(apRows[0].total)).toBe(180);

    // is_custom/third_party_name persisted on the invoice_items row.
    const { rows: [customRow] } = await db.query(
      `SELECT is_custom, third_party_name, cost_price_at_time FROM invoice_items
        WHERE invoice_id = $1 AND is_custom = true`,
      [invoiceId],
    );
    expect(customRow.is_custom).toBe(true);
    expect(customRow.third_party_name).toBe('Acme Lighting');
    expect(Number(customRow.cost_price_at_time)).toBe(180);

    // Every journal entry this flow posted must itself balance.
    const { rows: unbalanced } = await db.query(`
      SELECT je.id
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
       WHERE je.reference_type = 'invoice' AND je.reference_id = $1
       GROUP BY je.id
      HAVING SUM(jl.debit) <> SUM(jl.credit)
    `, [invoiceId]);
    expect(unbalanced).toHaveLength(0);
  });

  it('cancels a confirmed invoice with a custom line, reversing stock, cash and journal', async () => {
    await db.query(`UPDATE app_settings SET vat_enabled = true, vat_rate = 5`);
    const stockOf = async () => Number((await db.query(
      `SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId])).rows[0].stock_qty);
    const drawerBalance = async () => Number((await db.query(
      `SELECT current_balance FROM cash_drawer ORDER BY updated_at DESC LIMIT 1`)).rows[0].current_balance);

    const createRes = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({
        customerId,
        items: [
          { variantId, quantity: 1 },
          {
            isCustom: true,
            customDescription: 'Third-party fan',
            thirdPartyName: 'Acme Lighting',
            quantity: 1,
            unitPrice: 100,
            customCostPrice: 70,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;
    expect(createRes.body.data.total).toBe(210);

    const payRes = await request(app)
      .post(`/invoices/${invoiceId}/payments`)
      .auth(adminToken, { type: 'bearer' })
      .send({ idempotencyKey: randomUUID(), method: 'cash', amount: 210 });
    expect(payRes.status).toBe(201);

    const stockBefore = await stockOf();
    const cashBefore = await drawerBalance();
    const confirmRes = await request(app)
      .post(`/invoices/${invoiceId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(confirmRes.status).toBe(200);
    expect(await stockOf()).toBe(stockBefore - 1);
    expect(await drawerBalance()).toBe(cashBefore + 210);

    const cancelRes = await request(app)
      .post(`/invoices/${invoiceId}/cancel`)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'Customer changed mind' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');

    // Only the catalog line comes back into stock; cash leaves the drawer.
    expect(await stockOf()).toBe(stockBefore);
    expect(await drawerBalance()).toBe(cashBefore);

    // Sale + reversal net to zero on every account, incl. the third-party
    // payable (2001) and inventory (1004).
    const { rows: nonZero } = await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) AS net
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN chart_of_accounts a ON a.id = jl.account_id
       WHERE je.reference_id = $1
       GROUP BY a.code
      HAVING SUM(jl.debit - jl.credit) <> 0
    `, [invoiceId]);
    expect(nonZero).toEqual([]);
  });

  it('ignores a client-supplied taxRate and uses app_settings VAT rate', async () => {
    await db.query(`UPDATE app_settings SET vat_enabled = true, vat_rate = 5`);

    const createRes = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({
        customerId,
        taxRate: 0,
        items: [{ variantId, quantity: 1 }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.taxRate).toBe(5);
    expect(createRes.body.data.total).toBe(105);
  });

  it('uses zero tax when VAT is disabled in app_settings', async () => {
    await db.query(`UPDATE app_settings SET vat_enabled = false, vat_rate = 5`);

    const createRes = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({
        customerId,
        taxRate: 99,
        items: [{ variantId, quantity: 1 }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.taxRate).toBe(0);
    expect(createRes.body.data.total).toBe(100);

    await db.query(`UPDATE app_settings SET vat_enabled = true, vat_rate = 5`);
  });
});
