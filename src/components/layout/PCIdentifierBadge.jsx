export default function PCIdentifierBadge() {
  const id = window.electron?.pcIdentifier || 'WEB';
  const mode = window.electron?.mode || 'client';
  const isServer = mode === 'server';

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        isServer ? 'bg-blue-100 text-blue-800' : 'bg-surface-2 text-ink-muted'
      }`}
      title={`PC: ${id} · ${mode}`}
    >
      {id}
      {isServer ? ' · SERVER' : ''}
    </span>
  );
}
