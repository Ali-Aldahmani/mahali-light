import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PresenceWidget from './PresenceWidget';
import { useAuthStore } from '@/store/authStore';
import { usePresenceStore } from '@/store/presenceStore';

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
    usePresenceStore.setState({ onlineUsers: [] });
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
