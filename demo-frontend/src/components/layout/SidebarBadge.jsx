export default function SidebarBadge({ count, tone = 'accent' }) {
  if (!count || count <= 0) return null;
  const cls =
    tone === 'error'
      ? 'bg-error text-white'
      : tone === 'warning'
        ? 'bg-warning text-white'
        : 'bg-accent text-white';
  return (
    <span
      className={`inline-flex min-w-5 h-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium animate-pulse ${cls}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
