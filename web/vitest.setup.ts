import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// next/font is a compile-time transform; under jsdom there is nothing to load.
vi.mock('next/font/local', () => ({
  default: () => ({ className: '', variable: '', style: { fontFamily: 'sans-serif' } }),
}));
