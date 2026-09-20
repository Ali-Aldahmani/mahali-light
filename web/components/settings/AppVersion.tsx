import pkg from '../../package.json';
import { useAppSettingsStore } from '@/store/appSettingsStore';

export default function AppVersion({ className = '' }: { className?: string }) {
  // publicSettings.app_version comes from the server's own package.json, so
  // it reflects what's actually running right now — a self-update swaps
  // that file and restarts the process, but doesn't touch this frontend
  // bundle. Falls back to the bundled version only until that first fetch
  // resolves (see the dashboard layout's fetchPublic() call).
  const liveVersion = useAppSettingsStore((s) => s.publicSettings?.app_version);
  return (
    <p className={`text-xs text-ink-muted ${className}`}>
      Version v{liveVersion || pkg.version}
    </p>
  );
}
