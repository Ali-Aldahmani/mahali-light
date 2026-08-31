import {
  ShoppingCart,
  Truck,
  Wrench,
  ClipboardCheck,
  Undo2,
  ArrowDownLeft,
  ShieldAlert,
  ShieldCheck,
  PackagePlus,
} from 'lucide-react';
import Badge from './Badge.jsx';

const TYPES = {
  sale: { label: 'Sale', tone: 'accent', icon: ShoppingCart },
  purchase: { label: 'Purchase', tone: 'success', icon: Truck },
  adjustment: { label: 'Adjustment', tone: 'warning', icon: Wrench },
  count_correction: {
    label: 'Count Correction',
    tone: 'warning',
    icon: ClipboardCheck,
  },
  return_in: { label: 'Return In', tone: 'success', icon: ArrowDownLeft },
  return_out: { label: 'Return Out', tone: 'error', icon: Undo2 },
  quarantine: { label: 'Quarantine', tone: 'neutral', icon: ShieldAlert },
  quarantine_release: {
    label: 'Quarantine Released',
    tone: 'neutral',
    icon: ShieldCheck,
  },
  opening_stock: { label: 'Opening Stock', tone: 'muted', icon: PackagePlus },
};

export default function MovementTypeBadge({ type, size = 'md', iconOnly = false }) {
  const t = TYPES[type] || { label: type, tone: 'muted', icon: Wrench };
  const Icon = t.icon;
  return (
    <Badge tone={t.tone} size={size}>
      <Icon className="h-3.5 w-3.5" />
      {!iconOnly && <span>{t.label}</span>}
    </Badge>
  );
}

export function getMovementTypeLabel(type) {
  return TYPES[type]?.label || type;
}

export const MOVEMENT_TYPES = Object.keys(TYPES);
