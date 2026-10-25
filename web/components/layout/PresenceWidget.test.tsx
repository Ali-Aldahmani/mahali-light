import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PresenceWidget from './PresenceWidget';
import { useAuthStore } from '@/store/authStore';
import { usePresenceStore } from '@/store/presenceStore';
import { listOnline } from '@/services/presenceService';

// Smoke test proving permission-gated UI actually renders differently for
// different permission sets (audit finding MED-10) — real React rendering
// via Testing Library, not just pure-logic assertions. listOnline() is
// mocked so this never makes a real network call.
vi.mock('@/services/presenceService', () => ({
  listOnline: vi.fn().mockResolvedValue([
    { userId: 'u1', username: 'alice', role: 'Admin', pcIdentifier: 'PC1', status: 'online' },
  ]),
}));

describe('PresenceWidget permission gating', () => {
  beforeEach(() => {
    usePresenceStore.setState({ onlineUsers: [], revision: 0 });
  });

  it('renders nothing for a user without user.edit or user.force_logout', () => {
    useAuthStore.setState({ permissions: ['invoice.create'] });
    const { container } = render(<PresenceWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the online-users control for a user holding user.edit', async () => {
    useAuthStore.setState({ permissions: ['user.edit'] });
    render(<PresenceWidget />);
    await waitFor(() => expect(screen.getByText(/online/i)).toBeInTheDocument());
  });

  it('renders for a user holding only user.force_logout (either permission suffices)', async () => {
    useAuthStore.setState({ permissions: ['user.force_logout'] });
    render(<PresenceWidget />);
    await waitFor(() => expect(screen.getByText(/online/i)).toBeInTheDocument());
  });
});

describe('PresenceWidget names', () => {
  beforeEach(() => {
    usePresenceStore.setState({ onlineUsers: [], revision: 0 });
    useAuthStore.setState({ permissions: ['user.edit'] });
  });

  it("shows the employee's real name, with the username underneath", async () => {
    vi.mocked(listOnline).mockResolvedValueOnce([
      { userId: 'u1', username: 'cashier1', employeeName: 'Fatima Al Mansoori', role: 'Cashier', pcIdentifier: 'web-a', status: 'online' },
    ]);
    render(<PresenceWidget />);
    await waitFor(() => expect(usePresenceStore.getState().onlineUsers).toHaveLength(1));
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Fatima Al Mansoori')).toBeInTheDocument();
    expect(screen.getByText(/cashier1 ·/)).toBeInTheDocument();
  });

  it('a presence update replaces the whole entry for that user, and null removes them', () => {
    const { applyUpdate } = usePresenceStore.getState();
    applyUpdate({ userId: 'u2', entry: { userId: 'u2', username: 'sales2', employeeName: 'Omar Khalid', status: 'online' } });
    applyUpdate({ userId: 'u2', entry: { userId: 'u2', username: 'sales2', employeeName: 'Omar Khalid', status: 'idle' } });
    expect(usePresenceStore.getState().onlineUsers).toEqual([
      expect.objectContaining({ userId: 'u2', employeeName: 'Omar Khalid', status: 'idle' }),
    ]);
    applyUpdate({ userId: 'u2', entry: null });
    expect(usePresenceStore.getState().onlineUsers).toEqual([]);
  });

  it('a snapshot answered after a live update is read again instead of undoing it', async () => {
    let call = 0;
    vi.mocked(listOnline).mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        // An update lands while the first snapshot is in flight.
        usePresenceStore.getState().applyUpdate({ userId: 'u9', entry: null });
        return [{ userId: 'u9', username: 'gone', status: 'online' }];
      }
      return [];
    });
    await usePresenceStore.getState().refresh();
    expect(call).toBe(2);
    expect(usePresenceStore.getState().onlineUsers).toEqual([]);
    vi.mocked(listOnline).mockReset();
  });

  it('says so when the list cannot be loaded', async () => {
    vi.mocked(listOnline).mockRejectedValueOnce(new Error('offline'));
    render(<PresenceWidget />);
    fireEvent.click(await screen.findByRole('button'));
    expect(await screen.findByText(/Couldn.t load who is online/)).toBeInTheDocument();
  });
});
