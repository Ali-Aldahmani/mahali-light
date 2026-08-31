export default function RetentionSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'days',
  helper,
  onChange,
  locked = false,
}) {
  return (
    <div className="rounded-card border border-border bg-surface-2/30 p-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink">{label}</label>
        <span className="text-xs text-ink-muted">
          {locked ? 'Forever' : `Keep last ${value} ${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={locked ? max : value}
        disabled={locked}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="mt-2 w-full accent-accent disabled:opacity-50"
      />
      {helper && <p className="mt-1 text-xs text-ink-muted">{helper}</p>}
    </div>
  );
}
