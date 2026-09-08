'use client';

import RequirePermission from '@/components/guards/RequirePermission';
import JournalPage from '@/components/finance/JournalPage';

export default function FinanceJournalPage() {
  return (
    <RequirePermission permission="finance.view_journal">
      <JournalPage />
    </RequirePermission>
  );
}
