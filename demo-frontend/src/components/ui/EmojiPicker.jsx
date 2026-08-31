import { useState } from 'react';
import { cn } from '../../utils/cn.js';

// Curated emoji set well-suited to an electrical retail store.
const PRESETS = [
  '💡', '🔌', '🔦', '🛠️', '⚙️', '🔋', '🔧', '🪛',
  '📦', '🏷️', '⚡', '🔥', '🧰', '🧯', '🔩', '🔗',
  '🪜', '🗜️', '🖥️', '📡', '📺', '🎛️', '🚨', '🏠',
  '🏢', '🏪', '☀️', '🌙', '🎨', '🎄', '🚪', '🪟',
];

export default function EmojiPicker({ value, onChange, label = 'Icon' }) {
  const [custom, setCustom] = useState('');

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-ink">{label}</label>}
      <div className="rounded-input border border-border bg-surface p-2">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => onChange?.(null)}
            className={cn(
              'h-9 w-9 inline-flex items-center justify-center rounded-md text-xs text-ink-muted border border-border hover:bg-surface-2',
              !value && 'bg-accent-light border-accent text-accent',
            )}
            title="No icon"
          >
            ∅
          </button>
          {PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onChange?.(e)}
              className={cn(
                'h-9 w-9 inline-flex items-center justify-center rounded-md text-lg hover:bg-surface-2',
                value === e && 'bg-accent-light ring-1 ring-accent',
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Or paste any emoji…"
            className="flex-1 h-9 px-2 rounded-md border border-border bg-surface-2 text-sm outline-none focus:border-accent"
            maxLength={4}
          />
          <button
            type="button"
            disabled={!custom}
            onClick={() => {
              onChange?.(custom);
              setCustom('');
            }}
            className="h-9 px-3 rounded-md text-sm font-medium text-accent disabled:opacity-50 hover:bg-accent-light"
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
