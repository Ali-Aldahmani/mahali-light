import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { listRegistry } = require('../../server/controllers/reportController.js');
const { ROLE_DEFAULTS } = require('../../shared/permissions.js');
const reportService = require('../../server/services/reportService.js');

function capture(user) {
  let body;
  const req = { user };
  const res = {
    json(payload) {
      body = payload;
      return this;
    },
  };
  listRegistry(req, res);
  return body;
}

describe('GET /api/reports/registry filtering', () => {
  it('JWT-authenticated Cashier does not receive financial report types', () => {
    const body = capture({ permissions: ROLE_DEFAULTS.Cashier });
    expect(body.success).toBe(true);
    const types = body.data.map((e) => e.type);
    expect(types).toContain('sales_summary');
    expect(types).not.toContain('net_profit');
    expect(types).not.toContain('payroll');
    expect(types).not.toContain('vat');
  });

  it('employee_performance is listed when the user has own-only permission', () => {
    const body = capture({
      permissions: ['report.employee_performance_own'],
    });
    expect(body.data.some((e) => e.type === 'employee_performance')).toBe(true);
  });

  it('Admin-equivalent full key set sees every registry type', () => {
    const all = Object.keys(reportService.REGISTRY);
    const perms = [
      ...new Set(Object.values(reportService.REGISTRY).map((d) => d.permission)),
      'report.employee_performance_own',
      'report.employee_performance_all',
    ];
    const body = capture({ permissions: perms });
    expect(body.data).toHaveLength(all.length);
  });

  it('does not invent a new permission key for the registry itself', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'server/routes/reports.js'),
      'utf8',
    );
    expect(src).toMatch(/router\.get\('\/registry', ctrl\.listRegistry\)/);
    expect(src).not.toMatch(/registry'[\s\S]{0,80}requirePermission/);
  });
});
