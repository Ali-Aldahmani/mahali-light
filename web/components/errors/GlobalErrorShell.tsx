import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import PermissionDeniedModal from './PermissionDeniedModal';
import SessionExpiredModal from './SessionExpiredModal';
import ErrorModal from './ErrorModal';
import BugReportModal from './BugReportModal';
import OfflineBanner from './OfflineBanner';
import { addBreadcrumb } from '@/services/breadcrumbService';
import { useUiErrorStore } from '@/store/uiErrorStore';

export default function GlobalErrorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const openBugReport = useUiErrorStore((s) => s.openBugReport);

  useEffect(() => {
    addBreadcrumb('navigate', { to: pathname });
  }, [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        openBugReport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openBugReport]);

  return (
    <>
      <OfflineBanner />
      {children}
      <PermissionDeniedModal />
      <SessionExpiredModal />
      <ErrorModal />
      <BugReportModal />
    </>
  );
}
