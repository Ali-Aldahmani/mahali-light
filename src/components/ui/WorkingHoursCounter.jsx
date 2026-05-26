import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn.js';

// Live HH:MM counter for an employee currently checked in. Re-tints based
// on whether they're approaching/exceeding their standard shift hours.
function formatHoursMinutes(hours) {
  if (!hours || hours < 0) return '00:00';
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function WorkingHoursCounter({
  checkIn,
  checkOut = null,
  standardHours = 8,
  className = '',
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (checkOut) return undefined;
    if (!checkIn) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [checkIn, checkOut]);

  if (!checkIn) return <span className={cn('text-ink-muted', className)}>—</span>;

  const start = new Date(checkIn).getTime();
  const end = checkOut ? new Date(checkOut).getTime() : now;
  const hours = Math.max(0, (end - start) / (60 * 60 * 1000));

  let tone = 'text-success';
  const std = Number(standardHours || 8);
  if (hours >= std) tone = 'text-error';
  else if (hours >= std - 0.5) tone = 'text-warning';
  if (checkOut) {
    tone = hours >= std ? 'text-warning' : 'text-ink';
  }

  return (
    <span className={cn('font-mono tabular-nums', tone, className)}>
      {formatHoursMinutes(hours)}
    </span>
  );
}
