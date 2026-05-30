/**
 * Unit tests for stockService.
 *
 * Focus areas:
 *   1. normalizeQuantity behaviour — tested indirectly through applyStockMovement
 *      by injecting a mock DB client and inspecting what quantity reaches the
 *      UPDATE statement.
 *   2. Input validation guards — zero and non-numeric quantity must throw.
 *   3. Insufficient-stock guard — going below zero must throw BIZ_INSUFFICIENT_STOCK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('../../server/db/postgres', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  withTransaction: vi.fn(),
}));
vi.mock('../../server/services/reorderService', () => ({
  checkReorderThreshold: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../server/services/journalService', () => ({
  postStockAdjustmentEntry: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../server/services/notificationService', () => ({
  notifyManagersAndAdmins: vi.fn().mockResolvedValue(null),
}));

import { applyStockMovement } from '../../server/services/stockService.js';
import { ERROR_CODES } from '../../shared/errorCodes.js';

// ---------------------------------------------------------------------------
// Helper — builds a mock pg client whose query responses simulate a real
// product_variants row with a given starting stock_qty.
// ---------------------------------------------------------------------------
function makeMockClient({ stockQty = 100, quarantineQty = 0 } = {}) {
  return {
    query: vi.fn()
      // 1st call: SELECT ... FOR UPDATE (lock the variant row)
      .mockResolvedValueOnce({
        rows: [{ id: 'vid-1', product_id: 'pid-1', stock_qty: stockQty, quarantine_qty: quarantineQty }],
      })
      // 2nd call: SELECT unit_label FROM products
      .mockResolvedValueOnce({ rows: [{ unit_label: 'pcs' }] })
      // 3rd call: UPDATE product_variants SET stock_qty = ...
      .mockResolvedValueOnce({ rows: [] })
      // 4th call: INSERT INTO stock_movements RETURNING *
      .mockResolvedValueOnce({
        rows: [{
          id: 'mov-1',
          movement_type: 'purchase',
          quantity: 5,
          qty_before: stockQty,
          qty_after: stockQty + 5,
        }],
      })
      // Default fallback for any additional calls (e.g., journal entry)
      .mockResolvedValue({ rows: [] }),
  };
}

// Common call options
const BASE = {
  variantId: 'vid-1',
  skipReorderCheck: true,
  io: null,
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
describe('applyStockMovement — input validation', () => {
  it('throws VALIDATION_FAILED when quantity is zero', async () => {
    await expect(
      applyStockMovement({ ...BASE, client: makeMockClient(), type: 'purchase', quantity: 0 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('throws VALIDATION_FAILED when quantity is NaN', async () => {
    await expect(
      applyStockMovement({ ...BASE, client: makeMockClient(), type: 'purchase', quantity: NaN }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('throws VALIDATION_FAILED when quantity is a non-numeric string', async () => {
    await expect(
      applyStockMovement({ ...BASE, client: makeMockClient(), type: 'purchase', quantity: 'five' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('throws VALIDATION_FAILED when variantId is missing', async () => {
    await expect(
      applyStockMovement({ type: 'purchase', quantity: 5, skipReorderCheck: true }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('throws VALIDATION_FAILED when type is missing', async () => {
    await expect(
      applyStockMovement({ variantId: 'vid-1', quantity: 5, skipReorderCheck: true }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });
});

// ---------------------------------------------------------------------------
// normalizeQuantity — sign conventions enforced by type
// ---------------------------------------------------------------------------
describe('applyStockMovement — sign normalization', () => {
  it('POSITIVE_TYPE (purchase): always increases stock, even when a negative qty is supplied', async () => {
    const client = makeMockClient({ stockQty: 100 });
    await applyStockMovement({ ...BASE, client, type: 'purchase', quantity: -5 });

    // The UPDATE call (3rd query) receives [newQty, quarantineQty, variantId].
    // newQty should be 100 + 5 = 105, NOT 100 - 5 = 95.
    const updateCall = client.query.mock.calls[2];
    expect(updateCall[1][0]).toBe(105); // $1 = new stock_qty
  });

  it('POSITIVE_TYPE (return_in): normalises to absolute value', async () => {
    const client = makeMockClient({ stockQty: 50 });
    await applyStockMovement({ ...BASE, client, type: 'return_in', quantity: -3 });

    const updateCall = client.query.mock.calls[2];
    expect(updateCall[1][0]).toBe(53); // 50 + abs(-3) = 53
  });

  it('NEGATIVE_TYPE (sale): always decreases stock, even when a positive qty is supplied', async () => {
    const client = makeMockClient({ stockQty: 100 });
    // Provide the movement row as a sale for the INSERT mock
    client.query.mockResolvedValueOnce({ rows: [] }); // 3rd call override (UPDATE)
    // Reset and reconfigure
    const c = makeMockClient({ stockQty: 100 });
    await applyStockMovement({ ...BASE, client: c, type: 'sale', quantity: 10 });

    const updateCall = c.query.mock.calls[2];
    expect(updateCall[1][0]).toBe(90); // 100 - 10 = 90
  });

  it('SIGNED_ALLOWED (adjustment): preserves caller-supplied sign', async () => {
    const c1 = makeMockClient({ stockQty: 100 });
    await applyStockMovement({ ...BASE, client: c1, type: 'adjustment', quantity: +7 });
    expect(c1.query.mock.calls[2][1][0]).toBe(107); // +7

    const c2 = makeMockClient({ stockQty: 100 });
    await applyStockMovement({ ...BASE, client: c2, type: 'adjustment', quantity: -7 });
    expect(c2.query.mock.calls[2][1][0]).toBe(93); // -7
  });
});

// ---------------------------------------------------------------------------
// Insufficient-stock guard
// ---------------------------------------------------------------------------
describe('applyStockMovement — insufficient stock', () => {
  it('throws BIZ_INSUFFICIENT_STOCK when a sale would push stock below zero', async () => {
    const client = makeMockClient({ stockQty: 5 });
    await expect(
      applyStockMovement({ ...BASE, client, type: 'sale', quantity: 10 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.BIZ_INSUFFICIENT_STOCK });
  });

  it('throws BIZ_INSUFFICIENT_STOCK for adjustment_out that exceeds available stock', async () => {
    const client = makeMockClient({ stockQty: 3 });
    await expect(
      applyStockMovement({ ...BASE, client, type: 'adjustment_out', quantity: 5 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.BIZ_INSUFFICIENT_STOCK });
  });

  it('does NOT throw when sale exactly exhausts stock to zero', async () => {
    const client = makeMockClient({ stockQty: 10 });
    // Should resolve without error
    await expect(
      applyStockMovement({ ...BASE, client, type: 'sale', quantity: 10 }),
    ).resolves.toBeDefined();

    const updateCall = client.query.mock.calls[2];
    expect(updateCall[1][0]).toBe(0); // stock goes to exactly 0
  });
});
