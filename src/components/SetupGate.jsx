import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getPublicAppSettings } from '../services/appSettingsService.js';

export default function SetupGate({ children }) {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(true);

  useEffect(() => {
    getPublicAppSettings()
      .then((s) => setComplete(Boolean(s?.setup_completed)))
      .catch(() => setComplete(false))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-ink-muted">
        Loading…
      </div>
    );
  }

  if (!complete && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  if (complete && location.pathname === '/setup') {
    return <Navigate to="/login" replace />;
  }

  return children;
}
