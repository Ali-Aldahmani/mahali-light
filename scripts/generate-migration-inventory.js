#!/usr/bin/env node
/**
 * Development-only: parse Express routers into a contract inventory.
 * Does not import or execute application handlers.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'server/routes');

const MOUNTS = [
  ['/api/auth', 'auth.js', 'auth'],
  ['/api/users', 'users.js', 'users'],
  ['/api/employees', 'employees.js', 'employees'],
  ['/api/roles', 'roles.js', 'roles'],
  ['/api/presence', 'presence.js', 'presence'],
  ['/api/categories', 'categories.js', 'categories'],
  ['/api/attributes', 'attributes.js', 'attributes'],
  ['/api/products', 'products.js', 'products'],
  ['/api/variants', 'variants.js', 'variants'],
  ['/api/stock', 'stock.js', 'stock'],
  ['/api/settings', 'settings.js', 'settings'],
  ['/api/suppliers', 'suppliers.js', 'suppliers'],
  ['/api/purchase-orders', 'purchaseOrders.js', 'purchase-orders'],
  ['/api/supplier-payments', 'supplierPayments.js', 'supplier-payments'],
  ['/api/supplier-returns', 'supplierReturns.js', 'supplier-returns'],
  ['/api/customers', 'customers.js', 'customers'],
  ['/api/customer-payments', 'customerPayments.js', 'customer-payments'],
  ['/api/invoices', 'invoices.js', 'invoices'],
  ['/api/invoice-edit-requests', 'invoiceEditRequests.js', 'invoice-edit-requests'],
  ['/api/print', 'print.js', 'print'],
  ['/api/warranties', 'warranties.js', 'warranties'],
  ['/api/warranty-claims', 'warrantyClaims.js', 'warranty-claims'],
  ['/api/return-requests', 'returnRequests.js', 'returns'],
  ['/api/return-orders', 'returnOrders.js', 'return-orders'],
  ['/api/returns', 'returnRequests.js', 'returns-alias'],
  ['/api/cash-drawer', 'cashDrawer.js', 'cash-drawer'],
  ['/api/bank-accounts', 'bankAccounts.js', 'bank-accounts'],
  ['/api/treasury', 'treasury.js', 'treasury'],
  ['/api/attendance', 'attendance.js', 'attendance'],
  ['/api/leaves', 'leaves.js', 'leaves'],
  ['/api/leave-balances', 'leaveBalances.js', 'leave-balances'],
  ['/api/holidays', 'holidays.js', 'holidays'],
  ['/api/reports', 'reports.js', 'reports'],
  ['/api/bills', 'bills.js', 'bills'],
  ['/api/bill-payments', 'billPayments.js', 'bill-payments'],
  ['/api/expenses', 'expenses.js', 'expenses'],
  ['/api/expense-categories', 'expenseCategories.js', 'expense-categories'],
  ['/api/finance', 'finance.js', 'finance'],
  ['/api/analytics', 'analytics.js', 'analytics'],
  ['/api/forecast', 'forecast.js', 'forecast'],
  ['/api/notifications', 'notifications.js', 'notifications'],
  ['/api/backup', 'backup.js', 'backup'],
  ['/api/error-logs', 'errorLogs.js', 'error-logs'],
  ['/api/bug-reports', 'bugReports.js', 'bug-reports'],
  ['/api/app-settings', 'appSettings.js', 'app-settings'],
  ['/api/setup', 'setup.js', 'setup'],
  ['/api/search', 'search.js', 'search'],
];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/^\s*\/\/.*$/gm, '');
}

function extractPermissions(callSrc) {
  const keys = [];
  const re = /requirePermission\(\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(callSrc))) {
    const inner = m[1];
    for (const k of inner.match(/'([^']+)'|"([^"]+)"/g) || []) {
      keys.push(k.replace(/['"]/g, ''));
    }
  }
  return keys;
}

function parseRouter(filename) {
  const raw = fs.readFileSync(path.join(ROUTES, filename), 'utf8');
  const src = stripComments(raw);
  const ops = [];

  let routerAuth = false;
  let routerPerms = [];
  const lines = src.split('\n');
  let buf = '';
  let collecting = false;

  function flushStatement(stmt) {
    const useM = stmt.match(/router\.use\(\s*(.*)\)\s*;?$/s);
    if (useM) {
      if (/requireAuth\s*\(/.test(useM[1])) routerAuth = true;
      const p = extractPermissions(useM[1]);
      if (p.length) routerPerms = routerPerms.concat(p);
      return;
    }
    const rm = stmt.match(
      /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,([\s\S]*)\)\s*;?$/s,
    );
    if (!rm) return;
    const method = rm[1].toUpperCase();
    const routePath = rm[3];
    const rest = rm[4];
    const inlineAuth = /requireAuth\s*\(/.test(rest);
    const perms = extractPermissions(rest);
    const handlerMatch = rest.match(/([\w.]+)\s*$/);
    ops.push({
      method,
      path: routePath,
      auth: routerAuth || inlineAuth,
      permissions: [...new Set([...routerPerms, ...perms])],
      handler: handlerMatch ? handlerMatch[1].replace(/,$/, '').trim() : 'UNKNOWN',
    });
  }

  for (const line of lines) {
    if (!collecting && /router\.(get|post|put|patch|delete|use)\s*\(/.test(line)) {
      collecting = true;
      buf = line + '\n';
      const opens = (buf.match(/\(/g) || []).length;
      const closes = (buf.match(/\)/g) || []).length;
      if (opens && opens === closes && /;\s*$/.test(line)) {
        flushStatement(buf.trim());
        collecting = false;
        buf = '';
      }
      continue;
    }
    if (collecting) {
      buf += line + '\n';
      const opens = (buf.match(/\(/g) || []).length;
      const closes = (buf.match(/\)/g) || []).length;
      if (opens && opens <= closes) {
        flushStatement(buf.trim());
        collecting = false;
        buf = '';
      }
    }
  }

  return ops;
}

function joinPath(mount, p) {
  if (p === '/') return mount;
  return `${mount}${p.startsWith('/') ? p : `/${p}`}`;
}

const endpoints = [];
endpoints.push({
  method: 'GET',
  route: '/api/health',
  module: 'health',
  file: 'server/index.js',
  handler: 'inline',
  auth: false,
  permissions: [],
  notes: 'No JWT. Envelope { success, data: { status, service, time } }.',
});

for (const [mount, file, mod] of MOUNTS) {
  const ops = parseRouter(file);
  for (const op of ops) {
    endpoints.push({
      method: op.method,
      route: joinPath(mount, op.path),
      module: mod,
      file: `server/routes/${file}`,
      handler: op.handler,
      auth: op.auth,
      permissions: op.permissions,
      notes: mount === '/api/returns' ? 'Alias of /api/return-requests (same router).' : '',
    });
  }
}

function yamlEscape(s) {
  return String(s).replace(/"/g, '\\"');
}

function writeInventoryMd() {
  const unique = endpoints.filter((e) => e.module !== 'returns-alias' || true);
  const protectedCount = unique.filter((e) => e.auth).length;
  const permCount = unique.filter((e) => e.permissions.length).length;
  const lines = [];
  lines.push('# Express API inventory (current behavior)');
  lines.push('');
  lines.push('Generated from `server/routes/*.js` and `server/index.js` by `scripts/generate-migration-inventory.js`.');
  lines.push('Handler names are taken from the last argument of each `router.*` call.');
  lines.push('Request/response bodies are **not** inferred here; see `OPENAPI_CURRENT.yaml` (`x-verification-status`).');
  lines.push('');
  lines.push(`- Router operations parsed (including \`/api/returns\` alias): **${unique.length}**`);
  lines.push(`- JWT \`requireAuth\` (router-level or inline): **${protectedCount}**`);
  lines.push(`- Operations with at least one \`requirePermission\` key (router-level or inline): **${permCount}**`);
  lines.push('- Unauthenticated: `GET /api/health`, `POST /api/auth/login`, `GET|POST /api/setup/*`, `GET /api/app-settings/public`.');
  lines.push('');
  lines.push('| Method | Route | Module | Handler | Auth | Permissions | Source |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const e of unique) {
    const perm = e.permissions.length ? e.permissions.join(', ') : '—';
    const auth = e.auth ? 'JWT' : 'public';
    const note = e.notes ? ` ${e.notes}` : '';
    lines.push(
      `| ${e.method} | \`${e.route}\` | ${e.module} | \`${e.handler}\` | ${auth} | ${perm} | \`${e.file}\`${note} |`,
    );
  }
  lines.push('');
  lines.push('## Auth-required but no `requirePermission` on the route');
  lines.push('');
  lines.push('These still run `requireAuth` (or equivalent). Permission may be enforced inside the controller.');
  lines.push('');
  for (const e of unique.filter((x) => x.auth && !x.permissions.length)) {
    lines.push(`- \`${e.method} ${e.route}\` → \`${e.handler}\` (\`${e.file}\`)`);
  }
  lines.push('');
  lines.push('## Known controller-level authorization (verified in source)');
  lines.push('');
  lines.push('| Endpoint | Note | Source |');
  lines.push('| --- | --- | --- |');
  lines.push('| `GET /api/reports/:type` | Per-type permission map inside report controller | `server/controllers/reportController.js` |');
  lines.push('| `GET /api/reports/:type/export` | Same as report run | `server/controllers/reportController.js` |');
  lines.push('| `GET /api/analytics/employee-performance` | Own vs all enforced in controller | `server/routes/analytics.js`, analytics controller |');
  lines.push('| `PUT /api/users/:id` | `user.edit` only; `roleId` is accepted by Zod without `user.change_role` | `server/routes/users.js`, `usersController.update` |');
  lines.push('');
  fs.writeFileSync(path.join(ROOT, 'docs/migration-contracts/API_INVENTORY.md'), lines.join('\n'));
}

function writeOpenApi() {
  const unique = endpoints;
  const paths = {};
  for (const e of unique) {
    const p = e.route.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    if (!paths[p]) paths[p] = {};
    const opId = `${e.method.toLowerCase()}_${e.module}_${e.handler}`.replace(/[^\w]/g, '_');
    const op = {
      operationId: opId,
      tags: [e.module],
      summary: `${e.method} ${e.route}`,
      'x-source-file': e.file,
      'x-handler': e.handler,
      'x-auth-required': e.auth,
      'x-permissions': e.permissions,
      'x-verification-status':
        e.route === '/api/health' || e.route === '/api/auth/login' ? 'VERIFIED' : 'NOT_VERIFIED',
      responses: {
        '200': {
          description: 'Success envelope `{ success: true, data }` unless noted. Status 201 used by some creates.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SuccessEnvelope' },
            },
          },
        },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '404': { $ref: '#/components/responses/Error' },
        '409': { $ref: '#/components/responses/Error' },
        '422': { $ref: '#/components/responses/Error' },
        '500': { $ref: '#/components/responses/Error' },
      },
    };
    if (e.auth) {
      op.security = [{ bearerAuth: [] }];
    }
    if (e.permissions.length) {
      op.description = `Required permission(s) (ALL): ${e.permissions.join(', ')}`;
    }
    paths[p][e.method.toLowerCase()] = op;
  }

  const yaml = [];
  yaml.push('openapi: 3.1.0');
  yaml.push('info:');
  yaml.push('  title: Mahali Light Express API (current)');
  yaml.push('  version: "1.1.0"');
  yaml.push('  description: |');
  yaml.push('    Behavioral freeze of the existing Express API.');
  yaml.push('    Most request/response schemas are intentionally unmarked or NOT_VERIFIED.');
  yaml.push('    Do not treat this file as a greenfield design.');
  yaml.push('  x-generated-by: scripts/generate-migration-inventory.js');
  yaml.push('servers:');
  yaml.push('  - url: http://127.0.0.1:3000');
  yaml.push('    description: Typical production API port (local Mac may use 3002).');
  yaml.push('tags:');
  const tags = [...new Set(unique.map((e) => e.module))];
  for (const t of tags) yaml.push(`  - name: ${t}`);
  yaml.push('security: []');
  yaml.push('components:');
  yaml.push('  securitySchemes:');
  yaml.push('    bearerAuth:');
  yaml.push('      type: http');
  yaml.push('      scheme: bearer');
  yaml.push('      bearerFormat: JWT');
  yaml.push('      description: Authorization Bearer <jwt>. Session must exist in user_sessions.token_hash.');
  yaml.push('  schemas:');
  yaml.push('    ErrorObject:');
  yaml.push('      type: object');
  yaml.push('      required: [code, message]');
  yaml.push('      properties:');
  yaml.push('        code: { type: string }');
  yaml.push('        message: { type: string }');
  yaml.push('        details: { nullable: true }');
  yaml.push('        field: { type: string, nullable: true }');
  yaml.push('    ErrorEnvelope:');
  yaml.push('      type: object');
  yaml.push('      required: [success, error]');
  yaml.push('      properties:');
  yaml.push('        success: { type: boolean, enum: [false] }');
  yaml.push('        error: { $ref: "#/components/schemas/ErrorObject" }');
  yaml.push('    SuccessEnvelope:');
  yaml.push('      type: object');
  yaml.push('      required: [success]');
  yaml.push('      properties:');
  yaml.push('        success: { type: boolean, enum: [true] }');
  yaml.push('        data: {}');
  yaml.push('        meta:');
  yaml.push('          type: object');
  yaml.push('          description: Present on paginated lists (page, limit, total).');
  yaml.push('          x-verification-status: VERIFIED');
  yaml.push('    LoginRequest:');
  yaml.push('      type: object');
  yaml.push('      x-verification-status: VERIFIED');
  yaml.push('      required: [username, password]');
  yaml.push('      properties:');
  yaml.push('        username: { type: string }');
  yaml.push('        password: { type: string }');
  yaml.push('        pcIdentifier: { type: string, description: Optional till identifier }');
  yaml.push('  responses:');
  yaml.push('    Error:');
  yaml.push('      description: `{ success: false, error: { code, message, details, field } }`');
  yaml.push('      content:');
  yaml.push('        application/json:');
  yaml.push('          schema: { $ref: "#/components/schemas/ErrorEnvelope" }');
  yaml.push('paths:');

  function dump(obj, indent) {
    const pad = '  '.repeat(indent);
    if (Array.isArray(obj)) {
      if (!obj.length) {
        yaml.push(`${pad}[]`);
        return;
      }
      for (const item of obj) {
        if (item && typeof item === 'object') {
          yaml.push(`${pad}-`);
          dump(item, indent + 1);
        } else {
          yaml.push(`${pad}- ${JSON.stringify(item)}`);
        }
      }
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          yaml.push(`${pad}${k}:`);
          dump(v, indent + 1);
        } else if (typeof v === 'boolean' || typeof v === 'number') {
          yaml.push(`${pad}${k}: ${v}`);
        } else if (v === null) {
          yaml.push(`${pad}${k}: null`);
        } else {
          yaml.push(`${pad}${k}: ${JSON.stringify(v)}`);
        }
      }
    }
  }

  dump(paths, 1);

  fs.writeFileSync(path.join(ROOT, 'docs/migration-contracts/OPENAPI_CURRENT.yaml'), yaml.join('\n') + '\n');
}

fs.mkdirSync(path.join(ROOT, 'docs/migration-contracts'), { recursive: true });
writeInventoryMd();
writeOpenApi();

const uniqueNoAlias = endpoints.filter((e) => e.module !== 'returns-alias');
const stats = {
  totalIncludingAlias: endpoints.length,
  totalCanonical: uniqueNoAlias.length,
  protected: endpoints.filter((e) => e.auth).length,
  withPermission: endpoints.filter((e) => e.permissions.length).length,
};
fs.writeFileSync(
  path.join(ROOT, 'docs/migration-contracts/_inventory_stats.json'),
  JSON.stringify(stats, null, 2),
);
console.log(JSON.stringify(stats, null, 2));
