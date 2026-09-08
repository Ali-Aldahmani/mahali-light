'use client';

import RequirePermission from '@/components/guards/RequirePermission';
import JournalPage from '@/components/finance/JournalPage';

export default function FinanceJournalDetailPage() {
  return (
    <RequirePermission permission="finance.view_journal">
      <JournalPage />
    </RequirePermission>
  );
}
