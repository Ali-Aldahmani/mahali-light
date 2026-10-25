import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/services/notificationService', () => ({
  listNotifications: vi.fn(async () => ({
    data: [{ id: 1, title: 'Low stock', is_read: false, severity: 'warning' }],
    pagination: { page: 1, totalPages: 1 },
  })),
}));

import HeaderNotifications from './HeaderNotifications';
import { useNotificationStore } from '@/store/notificationStore';
import * as api from '@/services/notificationService';

describe('HeaderNotifications', () => {
  beforeEach(() => {
    useNotificationStore.getState().reset();
    vi.mocked(api.listNotifications).mockClear();
  });

  it('loads notifications on mount so the badge shows before the bell is opened', async () => {
    const { container } = render(<HeaderNotifications />);
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(1));
    expect(useNotificationStore.getState().panelOpen).toBe(false);
    await waitFor(() =>
      expect(container.querySelector('button[aria-label*="1 unread"]')).not.toBeNull(),
    );
  });
});
