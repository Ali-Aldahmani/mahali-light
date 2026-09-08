import { useState } from 'react';
import { Download } from 'lucide-react';
import Button, { type ButtonProps } from './Button';
import PermissionGate from './PermissionGate';
import { toast } from '@/store/toastStore';
import {
  downloadInvoicePdf,
  downloadPurchaseOrderPdf,
} from '@/services/pdfService';

export default function DownloadPDFButton({
  invoiceId,
  invoiceNumber,
  purchaseOrderId,
  purchaseOrderNumber,
  variant = 'secondary',
  size = 'md',
  className = '',
  label,
  permission = 'invoice.download',
}: {
  invoiceId?: string | number;
  invoiceNumber?: string;
  purchaseOrderId?: string | number;
  purchaseOrderNumber?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  label?: string;
  permission?: string;
}) {
  const [loading, setLoading] = useState(false);

  const fire = async () => {
    setLoading(true);
    try {
      let result;
      if (purchaseOrderId) {
        result = await downloadPurchaseOrderPdf(
          purchaseOrderId,
          purchaseOrderNumber,
        );
      } else if (invoiceId) {
        result = await downloadInvoicePdf(invoiceId, invoiceNumber);
      }
      if (result?.cancelled) return;
      if (result?.success === false) {
        toast.error(`Download failed${result.error ? `: ${result.error}` : '.'}`);
      } else if (result?.path) {
        toast.success(`Saved to ${result.path}`);
      } else if (result?.success !== false) {
        toast.success('PDF downloaded.');
      }
    } catch (err) {
      toast.error(err?.message || 'Could not download PDF.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PermissionGate permission={permission}>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        leftIcon={<Download className="h-4 w-4" />}
        onClick={fire}
        className={className}
      >
        {label || 'Download PDF'}
      </Button>
    </PermissionGate>
  );
}
