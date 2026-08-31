import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getPublicAppSettings } from '../services/appSettingsService.js';

export default function SetupGate({ children }) {
  const location = useLocation();
  const [ready, setReady] = useState(true);

  useEffect(() => {
    getPublicAppSettings().catch(() => {});
  }, []);

  return children;
}
