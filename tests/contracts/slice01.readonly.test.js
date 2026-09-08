import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const require = createRequire(import.meta.url);

describe('slice 01 GET is read-only', () => {
  it('getReorderForVariant and getAnnualPlanForVariant do not insert', async () => {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
    const { query } = require('../../server/db/postgres.js');
    const forecast = require('../../server/services/forecastService.js');

    try {
      await query('SELECT 1');
    } catch {
      expect(true).toBe(true);
      return;
    }

    const missing = randomUUID();
    const rrBefore = (await query('SELECT COUNT(*)::int AS n FROM reorder_recommendations')).rows[0]
      .n;
    const apBefore = (await query('SELECT COUNT(*)::int AS n FROM annual_stock_plans')).rows[0].n;

    const rec = await forecast.getReorderForVariant(missing);
    const plan = await forecast.getAnnualPlanForVariant(missing, 2024);
    expect(rec).toBeNull();
    expect(plan).toBeNull();

    const rrAfter = (await query('SELECT COUNT(*)::int AS n FROM reorder_recommendations')).rows[0]
      .n;
    const apAfter = (await query('SELECT COUNT(*)::int AS n FROM annual_stock_plans')).rows[0].n;
    expect(rrAfter).toBe(rrBefore);
    expect(apAfter).toBe(apBefore);
  });
});
