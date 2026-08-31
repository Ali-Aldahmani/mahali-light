import Badge from './Badge.jsx';

// Shows a coloured countdown badge:
//   > 90 days        → success/green
//   30–90 days       → warning/orange
//   0–29 days        → error/red
//   < 0 (expired)    → muted "Expired X days ago"
export default function DaysRemainingBadge({
  daysRemaining,
  size = 'md',
  className = '',
}) {
  const d = Number(daysRemaining);
  if (Number.isNaN(d)) {
    return (
      <Badge tone="muted" size={size} className={className}>
        —
      </Badge>
    );
  }
  if (d < 0) {
    return (
      <Badge tone="muted" size={size} className={className}>
        Expired {Math.abs(d)}d ago
      </Badge>
    );
  }
  let tone = 'success';
  let label = `${d} day${d === 1 ? '' : 's'} left`;
  if (d <= 29) {
    tone = 'error';
  } else if (d <= 90) {
    tone = 'warning';
  } else if (d > 365) {
    // Render in months for long stretches to avoid silly numbers like "418 days".
    const months = Math.round(d / 30);
    label = `${months} month${months === 1 ? '' : 's'} left`;
  }
  return (
    <Badge tone={tone} size={size} className={className}>
      {label}
    </Badge>
  );
}
