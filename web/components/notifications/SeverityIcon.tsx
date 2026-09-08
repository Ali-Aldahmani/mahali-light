import { AlertOctagon, AlertTriangle, Info, XCircle } from 'lucide-react';

const MAP = {
  info: { icon: Info, color: 'text-blue-500' },
  warning: { icon: AlertTriangle, color: 'text-warning' },
  error: { icon: XCircle, color: 'text-error' },
  critical: { icon: AlertOctagon, color: 'text-error' },
};

export default function SeverityIcon({ severity = 'info', size = 16, className = '', pulse = false }) {
  const { icon: Icon, color } = MAP[severity] || MAP.info;
  return (
    <Icon
      size={size}
      className={`${color} ${pulse && severity === 'critical' ? 'animate-pulse' : ''} ${className}`}
      aria-label={severity}
    />
  );
}
