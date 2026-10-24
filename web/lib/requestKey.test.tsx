import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { newRequestKey, withRequestKey } from './requestKey';
import { useRequestKey } from '@/hooks/useRequestKey';
import { canRetrySafely } from '@/services/http';

vi.mock('@/services/customerPaymentService', () => ({ collectPayment: vi.fn() }));
import { collectPayment } from '@/services/customerPaymentService';
import CollectPaymentSlideOver from '@/components/customers/CollectPaymentSlideOver';

describe('request keys', () => {
  afterEach(cleanup);

  it('are unique, and still generated on plain-HTTP pages without crypto.randomUUID', () => {
    expect(newRequestKey()).not.toBe(newRequestKey());
    const original = crypto.randomUUID;
    try {
      (crypto as any).randomUUID = undefined;
      const a = newRequestKey();
      expect(a).toMatch(/\S{12,}/);
      expect(newRequestKey()).not.toBe(a);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it('travel as an Idempotency-Key header, and nothing is sent without one', () => {
    expect(withRequestKey('abc')).toEqual({ headers: { 'Idempotency-Key': 'abc' } });
    expect(withRequestKey(null)).toBeUndefined();
  });

  it('stay the same while a form is open and change when it is opened again', () => {
    const { result, rerender } = renderHook(({ open }) => useRequestKey(open), { initialProps: { open: true } });
    const first = result.current.current();
    rerender({ open: true });
    expect(result.current.current()).toBe(first);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.current()).not.toBe(first);
  });

  it('a payment retried after a timeout sends the same key both times', async () => {
    vi.mocked(collectPayment)
      .mockRejectedValueOnce({ code: 'NETWORK_TIMEOUT', message: 'Request timed out.' })
      .mockResolvedValueOnce({ payment: { id: 'p1' } });
    render(
      <CollectPaymentSlideOver open onClose={() => {}} customer={{ id: 'c1', name: 'Debt Co', creditBalance: 100 }} />,
    );
    const submit = screen.getByRole('button', { name: /record payment/i });
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(collectPayment).toHaveBeenCalledTimes(1));
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(collectPayment).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(collectPayment).mock.calls;
    expect(first[2]).toEqual(expect.any(String));
    expect(second[2]).toBe(first[2]);
  });
});

describe('timeout Retry button', () => {
  it('is offered for reads and for commands that carry a request key', () => {
    expect(canRetrySafely({ method: 'get' })).toBe(true);
    expect(canRetrySafely({ method: 'post', headers: { 'Idempotency-Key': 'k' } })).toBe(true);
  });

  it('is not offered for a command without a key, which could apply twice', () => {
    expect(canRetrySafely({ method: 'post', headers: {} })).toBe(false);
    expect(canRetrySafely({ method: 'delete' })).toBe(false);
  });
});
