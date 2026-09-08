import pkg from '../../package.json';

export default function AppVersion({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-ink-muted ${className}`}>
      Version v{pkg.version}
    </p>
  );
}
