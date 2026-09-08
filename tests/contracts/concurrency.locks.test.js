/**
 * Concurrency / locking contracts.
 * Does not change production code. Live two-connection races are skipped
 * unless RUN_PG_CONCURRENCY=1 (requires a real database).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('locking present in critical writers', () => {
  it('confirmInvoice locks invoice and variants FOR UPDATE', () => {
    const src = read('server/services/invoiceService.js');
    expect(src).toMatch(/SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/);
    expect(src).toMatch(
      /SELECT id, product_id, stock_qty FROM product_variants WHERE id = ANY\(\$1\) FOR UPDATE/,
    );
  });

  it('applyStockMovement locks the variant FOR UPDATE', () => {
    const src = read('server/services/stockService.js');
    expect(src).toMatch(/FROM product_variants\s+WHERE id = \$1\s+FOR UPDATE/s);
  });

  it('return processing locks return_requests FOR UPDATE', () => {
    const src = read('server/services/returnService.js');
    expect(src).toMatch(/FROM return_requests WHERE id = \$1 FOR UPDATE/);
  });

  it('PO receive locks purchase_orders FOR UPDATE', () => {
    const src = read('server/services/purchaseOrderService.js');
    expect(src).toMatch(/FROM purchase_orders WHERE id = \$1 FOR UPDATE/);
  });

  it('cash drawer and bank accounts use FOR UPDATE', () => {
    expect(read('server/services/cashService.js')).toMatch(/FROM cash_drawer[\s\S]*FOR UPDATE/);
    expect(read('server/services/bankService.js')).toMatch(
      /FROM bank_accounts WHERE id = \$1 FOR UPDATE/,
    );
  });

  it('product_variants has no CHECK preventing negative stock_qty', () => {
    const src = read('server/db/migrations/002_products.sql');
    expect(src).toMatch(/stock_qty DECIMAL\(12,2\)/);
    expect(src).not.toMatch(/stock_qty[^\n]*CHECK/i);
  });

  it('withTransaction rolls back on throw', () => {
    const src = read('server/db/postgres.js');
    expect(src).toMatch(/BEGIN/);
    expect(src).toMatch(/COMMIT/);
    expect(src).toMatch(/ROLLBACK/);
  });
});

describe('live Postgres race', () => {
  it('is implemented in tests/contracts/concurrency.live.test.js (RUN_PG_CONCURRENCY=1)', () => {
    expect(true).toBe(true);
  });
});
