import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isAllowedOrigin } = require('../../server/utils/corsOrigins.js');

describe('CORS origin policy', () => {
  it('allows missing origin, Electron null, and loopback', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('null')).toBe(true);
    expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1')).toBe(true);
  });

  it('allows SERVER_IP http origins and rejects unrelated hosts', () => {
    process.env.SERVER_IP = '192.168.1.50';
    expect(isAllowedOrigin('http://192.168.1.50')).toBe(true);
    expect(isAllowedOrigin('https://192.168.1.50')).toBe(true);
    expect(isAllowedOrigin('http://192.168.1.99')).toBe(false);
    expect(isAllowedOrigin('http://evil.example')).toBe(false);
    delete process.env.SERVER_IP;
  });
});
