/**
 * Integration tests for authController.login.
 *
 * Mocking strategy for a fully-CJS codebase:
 *
 *   vitest's vi.mock() intercepts ESM imports but NOT transitive CJS
 *   require() calls deep inside the application.  The only reliable approach
 *   when every source file uses module.exports is:
 *
 *     1. createRequire(import.meta.url)   — get a handle on the CJS loader
 *     2. Wipe every server/* entry from require.cache
 *     3. Inject hand-rolled mocks for DB / auth / activityLog directly into
 *        require.cache before authController is first required
 *     4. require('authController') fresh — it now captures the mock functions
 *        at destructuring time
 *
 *   The controller is called directly (mock req/res/next) — this covers
 *   Zod validation, lockout logic, bcrypt comparison, JWT minting and the
 *   various error codes without needing a live HTTP server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import bcrypt from 'bcrypt';

// createRequire gives us a synchronous CJS require rooted at THIS file.
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MOCK_USER = {
  id: 'uid-1',
  username: 'admin',
  is_active: true,
  role_id: 'rid-1',
  role_name: 'Admin',
  employee_id: null,
  permissions: ['users.read'],
};

// Minimal classifyError inlined so the test's next() handler can convert
// AppError / ZodError into the { code, message, status } shape.
function classifyError(err) {
  if (err?.name === 'AppError') {
    return {
      code: err.code,
      message: err.message,
      status: err.status || 500,
      details: err.details || null,
      field: err.field || null,
    };
  }
  if (err?.name === 'ZodError') {
    return {
      code: 'VALIDATION_FAILED',
      message: 'The submitted data is invalid.',
      status: 400,
      details: null,
      field: null,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: err?.message || 'Internal server error',
    status: 500,
    details: null,
    field: null,
  };
}

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------
let mockQuery;
let mockWithTransaction;
let mockLoadUserContext;
let login;
let MOCK_USER_ROW;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Inject an object into require.cache under the given path so that any
 * subsequent require() of that path returns our mock without loading the
 * real file.
 */
function injectCache(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

/**
 * Clear every server/* file from require.cache so authController will be
 * loaded fresh in the next require().  Shared/ is left alone (pure JS).
 */
function clearServerCache() {
  for (const key of Object.keys(require.cache)) {
    // Normalise path separators for cross-platform comparison
    const norm = key.replace(/\\/g, '/');
    if (norm.includes('/server/') && !norm.includes('/node_modules/')) {
      delete require.cache[key];
    }
  }
}

// ---------------------------------------------------------------------------
// beforeEach — rebuild mock environment for each test
// ---------------------------------------------------------------------------
beforeEach(async () => {
  // Fresh bcrypt hash (BCRYPT_ROUNDS=1 set in tests/setup.js → very fast)
  MOCK_USER_ROW = {
    id: 'uid-1',
    username: 'admin',
    password_hash: await bcrypt.hash('secret123', 1),
    is_active: true,
    role_id: 'rid-1',
  };

  // Create fresh vi.fn() instances for each test
  mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  mockWithTransaction = vi.fn().mockImplementation(async (fn) => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    return fn(client);
  });
  mockLoadUserContext = vi.fn().mockResolvedValue(MOCK_USER);

  // Wipe all server modules so the next require() loads them fresh
  clearServerCache();

  // Inject mocks before authController is required below
  injectCache('../../server/db/postgres', {
    query: mockQuery,
    withTransaction: mockWithTransaction,
    getPool: vi.fn(),
  });

  injectCache('../../server/middleware/auth', {
    signToken: vi.fn().mockReturnValue('test.jwt.token.for.vitest'),
    hashToken: vi.fn().mockImplementation((t) => `hash_${String(t).slice(0, 8)}`),
    verifyToken: vi.fn().mockReturnValue({ sub: 'uid-1' }),
    loadUserContext: mockLoadUserContext,
    requireAuth: vi.fn().mockReturnValue((_req, _res, next) => next()),
  });

  injectCache('../../server/utils/activityLog', {
    logActivity: vi.fn().mockResolvedValue(null),
  });

  injectCache('../../server/services/attendanceService', {
    checkInSafe: vi.fn().mockResolvedValue(null),
    checkOutSafe: vi.fn().mockResolvedValue(null),
  });

  // Load authController fresh — all its require()s now hit the injected mocks
  const ctrl = require('../../server/controllers/authController');
  login = ctrl.login;
});

// ---------------------------------------------------------------------------
// callLogin helper — invoke the controller directly without an HTTP server
// ---------------------------------------------------------------------------
function callLogin(body) {
  return new Promise((resolve) => {
    const req = {
      body,
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      app: { get: () => null }, // io = null → socket emits are skipped
    };

    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { resolve({ status: statusCode, body: data }); },
    };

    const next = (err) => {
      if (!err) return;
      const c = classifyError(err);
      resolve({ status: c.status, body: { success: false, error: c } });
    };

    Promise.resolve(login(req, res, next)).catch((err) => {
      const c = classifyError(err);
      resolve({ status: c.status, body: { success: false, error: c } });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('authController.login', () => {
  it('returns 200 with a JWT token and sanitised user on valid credentials', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ fails: 0 }] })   // isLockedOut
      .mockResolvedValueOnce({ rows: [MOCK_USER_ROW] }); // find user

    const { status, body } = await callLogin({
      username: 'admin',
      password: 'secret123',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toBe('test.jwt.token.for.vitest');
    expect(body.data.user.username).toBe('admin');
    expect(body.data.user.role).toBe('Admin');
    // Sensitive fields must not leak through sanitizeUser()
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('is_active');
  });

  it('returns 401 when the password is wrong', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ fails: 0 }] })
      .mockResolvedValueOnce({ rows: [MOCK_USER_ROW] });

    const { status, body } = await callLogin({
      username: 'admin',
      password: 'WRONG_PASSWORD',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns 401 when the username does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ fails: 0 }] })
      .mockResolvedValueOnce({ rows: [] }); // user not found

    const { status, body } = await callLogin({
      username: 'nobody',
      password: 'anything',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns 423 when the account is locked after too many failed attempts', async () => {
    // MAX_FAILED_ATTEMPTS = 5; fails >= 5 triggers lockout.
    mockQuery.mockResolvedValueOnce({ rows: [{ fails: 5 }] });

    const { status, body } = await callLogin({
      username: 'admin',
      password: 'whatever',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(423);
    expect(body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
  });

  it('returns 403 when the account is inactive', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ fails: 0 }] })
      .mockResolvedValueOnce({ rows: [{ ...MOCK_USER_ROW, is_active: false }] });

    const { status, body } = await callLogin({
      username: 'admin',
      password: 'secret123',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe('AUTH_ACCOUNT_INACTIVE');
  });

  it('returns 400 when the password field is missing (Zod validation)', async () => {
    const { status, body } = await callLogin({ username: 'admin' });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 when the body is completely empty', async () => {
    const { status } = await callLogin({});

    expect(status).toBe(400);
  });

  it('returns 400 when username violates the Zod min-length rule', async () => {
    // loginSchema: username z.string().min(1) — empty string fails
    const { status } = await callLogin({
      username: '',
      password: 'secret123',
      pcIdentifier: 'PC-1',
    });

    expect(status).toBe(400);
  });

  it('succeeds without pcIdentifier (schema defaults to "unknown-pc")', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ fails: 0 }] })
      .mockResolvedValueOnce({ rows: [MOCK_USER_ROW] });

    const { status, body } = await callLogin({
      username: 'admin',
      password: 'secret123',
      // pcIdentifier omitted — Zod default kicks in
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});
