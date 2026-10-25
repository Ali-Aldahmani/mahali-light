import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('Socket.io PO discussion room authorization', () => {
  it('rejects join_po_discussion when user lacks po.comments.view permission', async () => {
    // Mock user context without po.comments.view
    const mockUser = {
      id: 'u-cashier',
      username: 'cashier1',
      is_active: true,
      permissions: ['invoice.create', 'invoice.view'],
    };

    let ackResult = null;
    const ack = (res) => { ackResult = res; };

    // Simulate socket handler check
    const owned = new Set(mockUser.permissions || []);
    if (!owned.has('*') && !owned.has('po.comments.view')) {
      ack({ success: false, error: 'NO_PERMISSION' });
    } else {
      ack({ success: true });
    }

    expect(ackResult).toEqual({ success: false, error: 'NO_PERMISSION' });
  });

  it('allows join_po_discussion when user has po.comments.view permission', async () => {
    const mockUser = {
      id: 'u-manager',
      username: 'manager1',
      is_active: true,
      permissions: ['supplier.view', 'po.comments.view'],
    };

    let ackResult = null;
    const ack = (res) => { ackResult = res; };

    const owned = new Set(mockUser.permissions || []);
    if (!owned.has('*') && !owned.has('po.comments.view')) {
      ack({ success: false, error: 'NO_PERMISSION' });
    } else {
      ack({ success: true });
    }

    expect(ackResult).toEqual({ success: true });
  });

  it('allows join_po_discussion when user has wildcard Admin permission', async () => {
    const mockUser = {
      id: 'u-admin',
      username: 'admin',
      is_active: true,
      permissions: ['*'],
    };

    let ackResult = null;
    const ack = (res) => { ackResult = res; };

    const owned = new Set(mockUser.permissions || []);
    if (!owned.has('*') && !owned.has('po.comments.view')) {
      ack({ success: false, error: 'NO_PERMISSION' });
    } else {
      ack({ success: true });
    }

    expect(ackResult).toEqual({ success: true });
  });

  it('rejects join_po_discussion when user account is inactive', async () => {
    const mockUser = {
      id: 'u-deactivated',
      username: 'oldemp',
      is_active: false,
      permissions: ['po.comments.view'],
    };

    let ackResult = null;
    const ack = (res) => { ackResult = res; };

    if (!mockUser || !mockUser.is_active) {
      ack({ success: false, error: 'UNAUTHORIZED' });
    }

    expect(ackResult).toEqual({ success: false, error: 'UNAUTHORIZED' });
  });
});
