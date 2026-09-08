import {
  Package,
  Receipt,
  Undo2,
  ShieldCheck,
  Calendar,
  Wallet,
  TrendingUp,
  Settings,
  CheckSquare,
  FileBarChart2,
  Bell,
} from 'lucide-react';

const MAP = {
  stock:      { icon: Package,        color: 'text-accent',  bg: 'bg-accent-light' },
  invoice:    { icon: Receipt,        color: 'text-blue-600', bg: 'bg-blue-50' },
  return:     { icon: Undo2,          color: 'text-purple-600', bg: 'bg-purple-50' },
  warranty:   { icon: ShieldCheck,    color: 'text-success', bg: 'bg-success-light' },
  attendance: { icon: Calendar,       color: 'text-indigo-600', bg: 'bg-indigo-50' },
  bill:       { icon: Wallet,         color: 'text-warning', bg: 'bg-warning-light' },
  finance:    { icon: TrendingUp,     color: 'text-green-700', bg: 'bg-green-50' },
  system:     { icon: Settings,       color: 'text-ink-muted', bg: 'bg-surface-2' },
  approval:   { icon: CheckSquare,    color: 'text-accent',  bg: 'bg-accent-light' },
  report:     { icon: FileBarChart2,  color: 'text-blue-600', bg: 'bg-blue-50' },
};

export default function CategoryIcon({ category = 'system', size = 16, className = '', withBg = false }) {
  const { icon: Icon, color, bg } = MAP[category] || MAP.system;
  if (withBg) {
    return (
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${bg} ${className}`}>
        <Icon size={size} className={color} />
      </span>
    );
  }
  return <Icon size={size} className={`${color} ${className}`} />;
}

export function CategoryEmoji({ category }) {
  switch (category) {
    case 'stock': return '📦';
    case 'invoice': return '🧾';
    case 'return': return '🔄';
    case 'warranty': return '🛡️';
    case 'attendance': return '📅';
    case 'bill': return '💰';
    case 'finance': return '📊';
    case 'system': return '⚙️';
    case 'approval': return '✅';
    case 'report': return '📈';
    default: return <Bell size={14} />;
  }
}
