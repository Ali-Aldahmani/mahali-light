import { Banknote, Building2, CreditCard, FileSpreadsheet } from 'lucide-react';

const META = {
  cash: { Icon: Banknote, label: 'Cash' },
  bank: { Icon: Building2, label: 'Bank' },
  bank_transfer: { Icon: Building2, label: 'Bank transfer' },
  cheque: { Icon: FileSpreadsheet, label: 'Cheque' },
  credit: { Icon: CreditCard, label: 'Credit' },
};

// Unified payment-method visual used by customer payments, supplier
// payments, the POS, and anywhere a method needs to render consistently.
export default function PaymentMethodIcon({
  method,
  size = 14,
  withLabel = true,
  className = '',
}) {
  const meta = META[method] || { Icon: Banknote, label: method || '—' };
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-ink ${className}`}>
      <Icon size={size} className="text-ink-muted" />
      {withLabel && <span>{meta.label}</span>}
    </span>
  );
}
