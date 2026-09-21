import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // web/ is its own separate npm package with its own vitest.config.ts
    // (jsdom environment, React Testing Library) — run via `npm --prefix
    // web test`. Without this exclude, this root run's default test glob
    // picks up web/'s *.test.ts(x) files too and tries to execute them
    // under the wrong environment/module resolution (no @/* alias here).
    exclude: ['**/node_modules/**', 'web/**', '**/.claude/**'],
    setupFiles: ['./tests/setup.js'],
    // Increase timeout slightly for integration tests that involve bcrypt
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'server/services/invoiceService.js',
        'server/services/stockService.js',
        'server/controllers/authController.js',
      ],
      exclude: ['**/node_modules/**', '**/tests/**'],
    },
  },
});
