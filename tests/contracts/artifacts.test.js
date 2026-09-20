import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Written for the FastAPI strangler-migration experiment archived under
// docs/archive/fastapi-slice01-experiment/ — most of docs/migration-contracts/
// was never generated (scripts/generate-migration-inventory.js only produces
// 2 of the 11 files these tests expect) and that work isn't active. Skipped
// rather than deleted so it's easy to pick back up if the migration resumes.
describe.skip('migration contract artifacts', () => {
  const dir = path.join(process.cwd(), 'docs/migration-contracts');
  const required = [
    'OPENAPI_CURRENT.yaml',
    'API_INVENTORY.md',
    'BUSINESS_RULES.md',
    'AUTHORIZATION_MATRIX.md',
    'ERROR_CONTRACT.md',
    'TRANSACTION_CONTRACTS.md',
    'SOCKET_EVENTS.md',
    'DATABASE_INVARIANTS.md',
    'FASTAPI_MIGRATION_ORDER.md',
    'STRANGLER_ARCHITECTURE.md',
    'CONTRACT_TEST_REPORT.md',
  ];

  it('contains every required freeze file', () => {
    for (const f of required) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
  });

  it('OpenAPI is 3.1 and marks unverified operations', () => {
    const yaml = fs.readFileSync(path.join(dir, 'OPENAPI_CURRENT.yaml'), 'utf8');
    expect(yaml.startsWith('openapi: 3.1.0')).toBe(true);
    expect(yaml).toMatch(/x-verification-status: ["']?NOT_VERIFIED["']?/);
    expect(yaml).toContain('bearerAuth');
  });

  it('inventory lists health and login as public', () => {
    const md = fs.readFileSync(path.join(dir, 'API_INVENTORY.md'), 'utf8');
    expect(md).toMatch(/GET \| `\/api\/health`/);
    expect(md).toMatch(/POST \| `\/api\/auth\/login`/);
  });
});
