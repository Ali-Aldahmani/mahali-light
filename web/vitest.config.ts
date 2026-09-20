import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Separate from the root project's vitest config (server-side, no jsdom) —
// web/ is its own npm package (audit finding: no npm workspace link), so
// its test runner lives here too. Mirrors the @/* path alias from
// web/tsconfig.json so tests can import the same way app code does.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
