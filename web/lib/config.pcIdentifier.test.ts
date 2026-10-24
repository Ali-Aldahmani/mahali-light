import { describe, expect, it } from 'vitest';
import { browserPcIdentifier, PC_IDENTIFIER } from './config';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('browser PC identifier', () => {
  it('is not the server hostname shared by every PC', () => {
    expect(PC_IDENTIFIER).not.toBe(`${window.location.hostname}-web`);
  });

  it('differs between two browsers and stays the same within one', () => {
    const pcA = memoryStorage();
    const pcB = memoryStorage();
    const a = browserPcIdentifier(pcA);
    expect(browserPcIdentifier(pcA)).toBe(a);
    expect(browserPcIdentifier(pcB)).not.toBe(a);
  });

  it('fits the login limit of 50 characters', () => {
    expect(browserPcIdentifier(memoryStorage()).length).toBeLessThanOrEqual(50);
  });

  it('still works where crypto.randomUUID is unavailable (plain-HTTP LAN)', () => {
    const original = crypto.randomUUID;
    try {
      // Simulate an insecure context.
      (crypto as any).randomUUID = undefined;
      expect(browserPcIdentifier(memoryStorage())).toMatch(/^web-/);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
