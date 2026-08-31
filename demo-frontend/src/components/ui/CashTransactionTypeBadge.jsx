import Badge from './Badge.jsx';
import {
  ShoppingCart,
  RotateCcw,
  Truck,
  UserPlus,
  Wallet,
  ArrowUp,
  ArrowDown,
  LockOpen,
  Lock,
  ArrowLeftRight,
  Receipt,
} from 'lucide-react';

const META = {
  sale: { tone: 'success', label: 'Sale', Icon: ShoppingCart },
  refund: { tone: 'error', label: 'Refund', Icon: RotateCcw },
  supplier_payment: { tone: 'warning', label: 'Supplier payment', Icon: Truck },
  customer_payment: {
    tone: 'success',
    label: 'Customer collection',
    Icon: UserPlus,
  },
  expense: { tone: 'error', label: 'Expense', Icon: Receipt },
  manual_in: { tone: 'success', label: 'Manual add', Icon: ArrowDown },
  manual_out: { tone: 'error', label: 'Manual remove', Icon: ArrowUp },
  manual_deposit: { tone: 'success', label: 'Manual deposit', Icon: ArrowDown },
  manual_withdrawal: {
    tone: 'error',
    label: 'Manual withdrawal',
    Icon: ArrowUp,
  },
  opening: { tone: 'accent', label: 'Drawer opened', Icon: LockOpen },
  closing: { tone: 'muted', label: 'Drawer closed', Icon: Lock },
  transfer: { tone: 'accent', label: 'Transfer', Icon: ArrowLeftRight },
  bill_payment: { tone: 'warning', label: 'Bill payment', Icon: Wallet },
};

export default function CashTransactionTypeBadge({
  type,
  size = 'sm',
  className = '',
  withIcon = true,
}) {
  const meta = META[type] || { tone: 'muted', label: type || '—' };
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {withIcon && Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}
