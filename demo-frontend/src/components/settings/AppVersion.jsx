import pkg from '../../../package.json';

export default function AppVersion({ className = '' }) {
  return (
    <p className={`text-xs text-ink-muted ${className}`}>
      Version v{pkg.version}
    </p>
  );
}
