import { useState } from 'react';
import { Download } from 'lucide-react';
import Button from './Button.jsx';
import PermissionGate from './PermissionGate.jsx';
import { toast } from '../../store/toastStore.js';
import {
  downloadInvoicePdf,
  downloadPurchaseOrderPdf,
} from '../../services/pdfService.js';

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
