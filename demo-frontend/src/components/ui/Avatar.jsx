import { initials } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

const PALETTE = [
  'bg-orange-100 text-orange-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-fuchsia-100 text-fuchsia-700',
];

function hashName(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export default function Avatar({
  name,
  src,
  size = 'md',
  className = '',
  online,
  status,
}) {
  const palette = PALETTE[hashName(name || '') % PALETTE.length];

  return (
    <div className={cn('relative inline-block', className)}>
      <div
        className={cn(
          'inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-border select-none',
          SIZES[size],
          src ? 'bg-surface-2' : palette,
        )}
      >
        {src ? (
          <img
            src={src}
            alt={name || ''}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface',
            online ? (status === 'idle' ? 'bg-warning' : 'bg-success') : 'bg-ink-muted/50',
          )}
        />
      )}
    </div>
  );
}
