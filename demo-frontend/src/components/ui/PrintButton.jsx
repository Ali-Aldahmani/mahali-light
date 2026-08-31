import { useState } from 'react';
import { Printer } from 'lucide-react';
import Button from './Button.jsx';
import PermissionGate from './PermissionGate.jsx';
import { toast } from '../../store/toastStore.js';
import { printInvoice, printReceipt } from '../../services/printService.js';

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
}) {
  const [loading, setLoading] = useState(false);

  const fire = async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const fn = kind === 'receipt' ? printReceipt : printInvoice;
      const result = await fn(invoiceId, { silent, printer });
      if (result?.success === false && !result?.cancelled) {
        toast.error(
          `Print failed${result.error ? `: ${result.error}` : '.'}`,
        );
      } else if (result?.fallback) {
        toast.info('PDF opened — use your browser to print.');
      } else if (result?.success !== false) {
        toast.success(
          `Sent ${invoiceNumber || 'document'} to ${
            kind === 'receipt' ? 'receipt' : 'invoice'
          } printer.`,
        );
      }
    } catch (err) {
      toast.error(err?.message || 'Could not print.');
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
