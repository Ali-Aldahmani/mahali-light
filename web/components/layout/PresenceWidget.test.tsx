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

describe('PresenceWidget accuracy (presence audit P2)', () => {
  beforeEach(() => {
    usePresenceStore.setState({ onlineUsers: [], revision: 0, loaded: true });
    useAuthStore.setState({ permissions: ['user.edit'] });
  });

  it('an update replaces the entry where it is, so the list does not jump', () => {
    usePresenceStore.setState({ onlineUsers: [
      { userId: 'a', username: 'a', status: 'online' }, { userId: 'b', username: 'b', status: 'online' },
    ] });
    usePresenceStore.getState().applyUpdate({ userId: 'b', entry: { userId: 'b', username: 'b', status: 'idle' } });
    expect(usePresenceStore.getState().onlineUsers.map((u) => `${u.userId}:${u.status}`)).toEqual(['a:online', 'b:idle']);
  });

  it('lists active people first, then idle, by name, with a device count', async () => {
    vi.mocked(listOnline).mockResolvedValueOnce([
      { userId: 'u1', username: 'zed', status: 'idle', pcIdentifier: 'p1' },
      { userId: 'u2', username: 'bob', status: 'online', pcIdentifier: 'p2', sessionCount: 2 },
      { userId: 'u3', username: 'amy', status: 'online', pcIdentifier: 'p3' },
    ]);
    render(<PresenceWidget />);
    await waitFor(() => expect(usePresenceStore.getState().onlineUsers).toHaveLength(3));
    fireEvent.click(screen.getByRole('button'));
    const names = (await screen.findAllByText(/^(amy|bob|zed)/)).map((n) => n.firstChild?.textContent);
    expect(names).toEqual(['amy', 'bob', 'zed']);
    expect(screen.getByText(/2 devices/)).toBeInTheDocument();
  });

  it('says the list is not live while this screen is disconnected', async () => {
    const { useSocketStore } = await import('@/store/socketStore');
    useSocketStore.setState({ isConnected: false });
    render(<PresenceWidget />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Not live/)).toBeInTheDocument();
    useSocketStore.setState({ isConnected: true });
  });
});

describe('timeAgo uses the server clock', () => {
  it('a PC clock 10 minutes fast still shows the right age', async () => {
    const { setServerTime } = await import('@/lib/utils/serverClock');
    const { timeAgo } = await import('@/lib/utils/format');
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60 * 1000);
    setServerTime(new Date(realNow).toISOString());
    expect(timeAgo(new Date(realNow - 2 * 60 * 1000))).toBe('2m ago');
    spy.mockRestore();
    setServerTime(new Date().toISOString());
  });
});
