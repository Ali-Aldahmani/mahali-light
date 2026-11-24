/**
 * Upgrade-lifecycle guards from the software engineering audit (22 Nov 2026):
 *   F-UPD-01  old code refuses to start on a database a newer version migrated
 *   F-MIG-02  two migration runners at once apply each file exactly once
 *   F-MIG-03  Admin receives the payroll / card-fee permissions on upgrade
 *   F-MIG-04  duplicate seeded categories are merged; the seed runs once
 *
 * Creates and drops its own databases on an explicitly selected local test
 * server, like the other tests in tests/integration.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

const migrationFiles = fs
  .readdirSync(path.join(__dirname, '../../server/db/migrations'))
  .filter((f) => f.endsWith('.sql'));

describe.skipIf(!enabled)('upgrade lifecycle on real PostgreSQL', () => {
  let db, admin, migrate, seedProducts;
  const database = `upgrade_lifecycle_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const ids = {};

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
    migrate = require('../../server/db/migrate');
    seedProducts = require('../../server/db/seedProducts');

    // An install from before 071 whose boot seed ran several times: three
    // "Lighting" roots, each with its own "LED Bulbs", products spread over
    // two of them, and attribute links on the duplicates.
    await migrate.runMigrations({ stopBefore: '071_' });
    const root = async (name, createdAt) => (await db.query(
      `INSERT INTO product_categories (name, requires_serial, created_at) VALUES ($1, false, $2) RETURNING id`,
      [name, createdAt],
    )).rows[0].id;
    ids.l1 = await root('Lighting', '2026-01-01');
    ids.l2 = await root('Lighting', '2026-02-01');
    ids.l3 = await root(' lighting ', '2026-03-01');
    ids.tools = await root('Tools', '2026-01-01');
    // The shop's own edit on the one that will be kept must survive.
    await db.query(`UPDATE product_categories SET requires_serial = true, description = 'Ours' WHERE id = $1`, [ids.l2]);
    for (const [key, parent] of [['b1', ids.l1], ['b2', ids.l2], ['b3', ids.l3]]) {
      ids[key] = (await db.query(
        `INSERT INTO product_categories (name, parent_id) VALUES ('LED Bulbs', $1) RETURNING id`, [parent],
      )).rows[0].id;
    }
    const product = async (name, category) => (await db.query(
      `INSERT INTO products (name, category_id) VALUES ($1, $2) RETURNING id`, [name, category],
    )).rows[0].id;
    // l2 has the most products, so it is kept although l1 is older.
    ids.p1 = await product('Lamp A', ids.l2);
    ids.p2 = await product('Lamp B', ids.l2);
    ids.p3 = await product('Lamp C', ids.l1);
    ids.p4 = await product('Bulb', ids.b3);
    const attr = async (name) => (await db.query(
      `INSERT INTO product_attributes (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name],
    )).rows[0].id;
    ids.watt = await attr('Test Wattage');
    ids.colour = await attr('Test Colour');
    await db.query(`INSERT INTO category_attributes (category_id, attribute_id, is_required) VALUES ($1,$2,true)`, [ids.l2, ids.watt]);
    await db.query(`INSERT INTO category_attributes (category_id, attribute_id, is_required) VALUES ($1,$2,false)`, [ids.l1, ids.watt]);
    await db.query(`INSERT INTO category_attributes (category_id, attribute_id) VALUES ($1,$2)`, [ids.l3, ids.colour]);

    await migrate.runMigrations();
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.closePool();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  describe('F-MIG-04 duplicate categories (migration 071)', () => {
    it('keeps one active "Lighting" — the one with the most products — and its own settings', async () => {
      const { rows } = await db.query(
        `SELECT id, requires_serial, description FROM product_categories
          WHERE lower(btrim(name)) = 'lighting' AND parent_id IS NULL AND is_active = true`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(ids.l2);
      expect(rows[0].requires_serial).toBe(true);
      expect(rows[0].description).toBe('Ours');
      const { rows: inactive } = await db.query(
        `SELECT id FROM product_categories WHERE id = ANY($1) AND is_active = false ORDER BY id`, [[ids.l1, ids.l3]],
      );
      expect(inactive).toHaveLength(2);
    });

    it('moves products and merges the subcategories one level down', async () => {
      const { rows } = await db.query(`SELECT id, category_id FROM products WHERE id = ANY($1)`, [[ids.p1, ids.p2, ids.p3, ids.p4]]);
      const byId = new Map(rows.map((r) => [r.id, r.category_id]));
      expect(byId.get(ids.p3)).toBe(ids.l2);
      const { rows: bulbs } = await db.query(
        `SELECT id FROM product_categories WHERE name = 'LED Bulbs' AND is_active = true`,
      );
      expect(bulbs).toHaveLength(1);
      // The bulb product followed its subcategory into the kept one.
      expect(byId.get(ids.p4)).toBe(bulbs[0].id);
      const { rows: [kept] } = await db.query(`SELECT parent_id FROM product_categories WHERE id = $1`, [bulbs[0].id]);
      expect(kept.parent_id).toBe(ids.l2);
    });

    it('merges attribute links, keeping the kept category\'s own setting', async () => {
      const { rows } = await db.query(
        `SELECT attribute_id, is_required FROM category_attributes WHERE category_id = $1`, [ids.l2],
      );
      const byAttr = new Map(rows.map((r) => [r.attribute_id, r.is_required]));
      expect(byAttr.get(ids.watt)).toBe(true);
      expect(byAttr.has(ids.colour)).toBe(true);
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM category_attributes WHERE category_id = ANY($1)`, [[ids.l1, ids.l3]],
      );
      expect(n).toBe(0);
    });

    it('refuses a second active category with the same name, with a clear message', async () => {
      const err = await db.query(`INSERT INTO product_categories (name) VALUES ('LIGHTING')`).catch((e) => e);
      expect(err.code).toBe('23505');
      const { classifyError } = require('../../server/services/errorLogService');
      const c = classifyError(err);
      expect(c.status).toBe(409);
      expect(c.message).toBe('A category with this name already exists here.');
      // A removed (inactive) name can be reused.
      await db.query(`INSERT INTO product_categories (name, is_active) VALUES ('Tools', false)`);
    });

    it('never runs the reference seed again on an install that already had categories', async () => {
      const before = (await db.query(`SELECT COUNT(*)::int AS n FROM product_categories`)).rows[0].n;
      await db.query(`UPDATE product_categories SET requires_serial = false WHERE id = $1`, [ids.tools]);
      await seedProducts.run();
      await seedProducts.run();
      const after = (await db.query(`SELECT COUNT(*)::int AS n FROM product_categories`)).rows[0].n;
      expect(after).toBe(before);
      const { rows: [tools] } = await db.query(`SELECT requires_serial FROM product_categories WHERE id = $1`, [ids.tools]);
      expect(tools.requires_serial).toBe(false);
    });
  });

  describe('F-UPD-01 newer-schema boot guard', () => {
    it('refuses to start when the database has a migration this build does not ship', async () => {
      await db.query(`INSERT INTO _migrations (filename) VALUES ('999_from_a_newer_version.sql')`);
      try {
        const err = await migrate.runMigrations().catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('SCHEMA_NEWER_THAN_CODE');
        expect(err.message).toContain('999_from_a_newer_version.sql');

        process.env.MIGRATE_ALLOW_NEWER_SCHEMA = '1';
        await expect(migrate.runMigrations()).resolves.toBeUndefined();
      } finally {
        delete process.env.MIGRATE_ALLOW_NEWER_SCHEMA;
        await db.query(`DELETE FROM _migrations WHERE filename = '999_from_a_newer_version.sql'`);
      }
    });

    it('starts normally when the database matches the code', async () => {
      await expect(migrate.runMigrations()).resolves.toBeUndefined();
    });
  });

  describe('F-MIG-03 permission grants (migration 070)', () => {
    it('grants Admin the payroll and card-fee permissions an upgraded install never received', async () => {
      const keys = ['finance.manage_payment_fees', 'payroll.view', 'payroll.manage', 'payroll.approve', 'payroll.pay'];
      await db.query(`INSERT INTO roles (name, is_system) VALUES ('Admin', true) ON CONFLICT (name) DO NOTHING`);
      // The state of an upgraded install: keys exist, Admin holds none of them.
      await db.query(
        `DELETE FROM role_permissions rp USING roles r, permissions p
          WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.name = 'Admin' AND p.key = ANY($1)`,
        [keys],
      );
      await db.query(`DELETE FROM _migrations WHERE filename LIKE '070_%'`);
      await migrate.runMigrations();
      const { rows } = await db.query(
        `SELECT p.key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'Admin' AND p.key = ANY($1) ORDER BY p.key`,
        [keys],
      );
      expect(rows.map((r) => r.key)).toEqual([...keys].sort());
    });
  });
});

describe.skipIf(!enabled)('fresh install: migration runner lock and one-time seed', () => {
  let db, admin, migrate, seedProducts;
  const database = `fresh_install_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  beforeAll(async () => {
    // Vitest isolates modules per file, not per describe: reset the pool so
    // it connects to this file's second database.
    db = require('../../server/db/postgres');
    await db.closePool();
    process.env.PGDATABASE = database;
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    migrate = require('../../server/db/migrate');
    seedProducts = require('../../server/db/seedProducts');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.closePool();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('two runners at once both succeed and apply every file exactly once (F-MIG-02)', async () => {
    await Promise.all([migrate.runMigrations(), migrate.runMigrations()]);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM _migrations`);
    expect(n).toBe(migrationFiles.length);
  }, 60000);

  it('a transaction whose connection dies reports the real error and the pool recovers (F-TX-08)', async () => {
    const err = await db
      .withTransaction(async (client) => {
        await client.query('SELECT pg_terminate_backend(pg_backend_pid())');
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // The terminate error itself, not a secondary ROLLBACK failure.
    expect(err.code === '57P01' || /terminat/i.test(err.message)).toBe(true);
    const { rows: [{ ok }] } = await db.query('SELECT 1 AS ok');
    expect(ok).toBe(1);
  });

  it('seeds reference categories on the first start only, keeping later edits (F-MIG-04)', async () => {
    await seedProducts.run();
    const count = async () => (await db.query(`SELECT COUNT(*)::int AS n FROM product_categories`)).rows[0].n;
    const first = await count();
    expect(first).toBeGreaterThan(0);
    await db.query(`UPDATE product_categories SET requires_serial = true WHERE name = 'Lighting' AND parent_id IS NULL`);
    await seedProducts.run();
    await seedProducts.run();
    expect(await count()).toBe(first);
    const { rows: [lighting] } = await db.query(
      `SELECT requires_serial FROM product_categories WHERE name = 'Lighting' AND parent_id IS NULL`,
    );
    expect(lighting.requires_serial).toBe(true);
  });
});
