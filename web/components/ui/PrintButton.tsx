import { useState } from 'react';
import { Printer } from 'lucide-react';
import Button, { type ButtonProps } from './Button';
import PermissionGate from './PermissionGate';
import { printInvoiceDocument } from '@/lib/invoices/invoiceDocuments';

// Two flavours: `kind="invoice"` prints the full A4 invoice, `kind="receipt"`
// prints the 80mm thermal receipt.
export default function PrintButton({
  invoiceId,
  invoiceNumber,
  kind = 'invoice',
  variant = 'secondary',
  size = 'md',
  silent,
  printer,
  className = '',
  label,
}: {
  invoiceId?: string | number;
  invoiceNumber?: string;
  kind?: 'invoice' | 'receipt';
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  silent?: boolean;
  printer?: string;
  className?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  const fire = async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      await printInvoiceDocument({ invoiceId, invoiceNumber, kind, silent, printer });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PermissionGate permission="invoice.print">
      <Button
        variant={variant}
        size={size}
        loading={loading}
        leftIcon={<Printer className="h-4 w-4" />}
        onClick={fire}
        className={className}
        title={
          kind === 'receipt'
            ? 'Print thermal receipt'
            : 'Print invoice (A4)'
        }
      >
        {label || (kind === 'receipt' ? 'Print receipt' : 'Print invoice')}
      </Button>
    </PermissionGate>
  );
}
