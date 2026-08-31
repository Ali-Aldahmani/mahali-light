import Badge from './Badge.jsx';

const META = {
  customer_refund: { tone: 'accent', label: 'Customer refund' },
  customer_replace: { tone: 'success', label: 'Customer replace' },
  supplier_return: { tone: 'warning', label: 'Supplier return' },
};

// Per spec the visual choice is:
//   refund   → blue-ish (we use accent which is the closest in this palette)
//   replace  → purple (mapped to success/green since no purple exists,
//              but readable as "positive completion")
//   supplier → orange (warning)
export default function ReturnTypeBadge({ type, size = 'md', className = '' }) {
  const meta = META[type] || { tone: 'muted', label: type || '—' };
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {meta.label}
    </Badge>
  );
}
