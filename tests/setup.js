import os from 'node:os';
import path from 'node:path';

// Global test environment — loaded once before any test file.
// Set the environment variables that server modules read at load-time so
// modules don't throw on import even when the real .env is absent.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz-32';
process.env.BCRYPT_ROUNDS = '1'; // 1 round so bcrypt tests run fast
process.env.CORS_ORIGINS = '';
// Keep the first-run setup code file (setupTokenService) out of the repo.
process.env.SETUP_CODE_FILE = path.join(os.tmpdir(), `mahali-test-setup-code-${process.pid}.txt`);
