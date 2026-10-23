import { useState } from 'react';
import { Download } from 'lucide-react';
import Button, { type ButtonProps } from './Button';
import PermissionGate from './PermissionGate';
import { downloadDocumentPdf } from '@/lib/invoices/invoiceDocuments';

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
      await downloadDocumentPdf({ invoiceId, invoiceNumber, purchaseOrderId, purchaseOrderNumber });
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
