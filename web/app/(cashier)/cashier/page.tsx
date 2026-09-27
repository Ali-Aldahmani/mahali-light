'use client';

import RequirePermission from '@/components/guards/RequirePermission';
import CashierTerminal from '@/components/cashier/CashierTerminal';

// Cashier Mode is an interface, not a role: anyone allowed to sell
// (invoice.create) can use it. Every action inside is still gated by its own
// permission and re-checked by the API.
export default function CashierModePage() {
  return (
    <RequirePermission permission="invoice.create">
      <CashierTerminal />
    </RequirePermission>
  );
}
