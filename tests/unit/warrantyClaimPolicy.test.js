import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertWarrantyClaimStatusTransition } = require('../../shared/warrantyClaimPolicy.js');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes.js');

describe('warrantyClaimPolicy', () => {
  it('allows open → in_progress', () => {
    expect(() => assertWarrantyClaimStatusTransition('open', 'in_progress')).not.toThrow();
  });

  it('blocks in_progress → open', () => {
    expect(() => assertWarrantyClaimStatusTransition('in_progress', 'open')).toThrowError(AppError);
    try {
      assertWarrantyClaimStatusTransition('in_progress', 'open');
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.BIZ_INVALID_STATE);
    }
  });

  it('blocks resolved → in_progress', () => {
    expect(() => assertWarrantyClaimStatusTransition('resolved', 'in_progress')).toThrow();
  });
});
