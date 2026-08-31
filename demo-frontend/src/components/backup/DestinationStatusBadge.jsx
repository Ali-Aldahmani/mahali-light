import { HardDrive, Server, Usb } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const ICON_MAP = {
  local: HardDrive,
  nas: Server,
  usb: Usb,
};

const STATE_TONES = {
  ok: 'text-success',
  fail: 'text-error',
  unknown: 'text-ink-muted',
  off: 'text-ink-muted/60',
};

export default function DestinationStatusBadge({ destination }) {
  if (!destination) return null;
  const Icon = ICON_MAP[destination.type] || HardDrive;
  let state = 'unknown';
  let detail = '';
  if (!destination.enabled) {
    state = 'off';
    detail = 'Disabled';
  } else if (destination.type === 'usb') {
    state = destination.ok ? 'ok' : 'fail';
    detail =
      destination.detected > 0
        ? `${destination.detected} drive${destination.detected === 1 ? '' : 's'}`
        : 'Not detected';
  } else if (destination.ok === true) {
    state = 'ok';
    detail = destination.path || 'Connected';
  } else if (destination.ok === false) {
    state = 'fail';
    detail = destination.error || 'Disconnected';
  }
  const tone = STATE_TONES[state];
  return (
    <div className={cn('flex items-center gap-2 text-sm', tone)}>
      <Icon size={14} />
      <span className="font-medium capitalize text-ink">{destination.type}</span>
      <span className="ml-auto truncate text-xs">{detail}</span>
    </div>
  );
}
