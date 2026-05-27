import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PermissionDeniedModal from './PermissionDeniedModal.jsx';
import SessionExpiredModal from './SessionExpiredModal.jsx';
import ErrorModal from './ErrorModal.jsx';
import BugReportModal from './BugReportModal.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import { addBreadcrumb } from '../../services/breadcrumbService.js';
import { useUiErrorStore } from '../../store/uiErrorStore.js';

export default function GlobalErrorShell({ children }) {
  const location = useLocation();
  const openBugReport = useUiErrorStore((s) => s.openBugReport);

  useEffect(() => {
    addBreadcrumb('navigate', { to: location.pathname });
  }, [location.pathname]);

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
