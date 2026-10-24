import { describe, expect, it } from 'vitest';
import { newPoSavedMessage } from './newPoMessage';

describe('new PO saved message', () => {
  it('does not announce a payment that failed', () => {
    const msg = newPoSavedMessage({ asDraft: false, poNumber: 'PO-2026-0007', received: true, paymentRecorded: false });
    expect(msg).toBe('PO PO-2026-0007 confirmed and received.');
    expect(msg).not.toMatch(/payment/i);
  });

  it('announces a payment that went through', () => {
    expect(newPoSavedMessage({ asDraft: false, poNumber: 'PO-1', received: false, paymentRecorded: true }))
      .toBe('PO PO-1 confirmed and payment recorded.');
    expect(newPoSavedMessage({ asDraft: false, poNumber: 'PO-1', received: true, paymentRecorded: true }))
      .toBe('PO PO-1 confirmed, received, and payment recorded.');
  });

  it('a draft is just saved', () => {
    expect(newPoSavedMessage({ asDraft: true, poNumber: 'PO-1', received: false, paymentRecorded: false }))
      .toBe('PO saved as draft.');
  });
});
