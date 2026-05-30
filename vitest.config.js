import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
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
