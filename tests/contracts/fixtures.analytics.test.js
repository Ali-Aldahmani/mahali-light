import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { requirePermission } = require('../../server/middleware/permissions.js');
const { requireAuth } = require('../../server/middleware/auth.js');
const { ERROR_CODES, AppError } = require('../../shared/errorCodes.js');

const dir = path.join(
  process.cwd(),
  'docs/migration-contracts/fixtures/analytics-forecast',
);

describe('analytics-forecast fixtures', () => {
  it('unauthorized fixture matches requireAuth', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'errors.json'), 'utf8'));
    let err;
    await requireAuth()({ headers: {} }, {}, (e) => {
      err = e;
    });
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(fixture.unauthorized.body.error.code);
    expect(err.status).toBe(401);
  });

  it('forbidden fixture matches requirePermission analytics.view_reorder', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'errors.json'), 'utf8'));
    let err;
    requirePermission('analytics.view_reorder')(
      { user: { permissions: ['analytics.view_dashboard'] } },
      {},
      (e) => {
        err = e;
      },
    );
    expect(err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(err.details.missing).toEqual(
      fixture.forbidden_forecast_reorder.body.error.details.missing,
    );
  });

  it('reorder empty success matches documented envelope', () => {
    const fx = JSON.parse(
      fs.readFileSync(path.join(dir, 'GET_forecast_reorder.json'), 'utf8'),
    );
    expect(fx.success_empty.body).toEqual({ success: true, data: [] });
  });
});
