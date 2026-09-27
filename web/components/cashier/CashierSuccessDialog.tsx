'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import PrintButton from '@/components/ui/PrintButton';
import PermissionGate from '@/components/ui/PermissionGate';
import { formatCurrency } from '@/lib/utils/format';

export interface CompletedSale {
  invoiceId: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  change: number;
  customerName: string | null;
}

export default function CashierSuccessDialog({
  sale,
  onNewSale,
}: {
  sale: CompletedSale | null;
  onNewSale: () => void;
}) {
  const newSaleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sale) return;
    const t = setTimeout(() => newSaleRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [sale]);

  return (
    <Modal
      open={!!sale}
      onClose={onNewSale}
      title="Sale complete"
      size="sm"
      footer={
        <Button ref={newSaleRef} size="touch" onClick={onNewSale} className="w-full">
          New sale (Enter)
        </Button>
      }
    >
      {sale && (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-success" aria-hidden />
          <div>
            <p className="text-sm text-ink-muted">Invoice {sale.invoiceNumber}</p>
            <p className="text-3xl font-bold text-ink">{formatCurrency(sale.total)}</p>
            {sale.customerName && <p className="text-sm text-ink-muted">{sale.customerName}</p>}
          </div>
          {sale.change > 0 && (
            <div className="rounded-card bg-success-light px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-success">Change due</p>
              <p className="text-2xl font-bold text-success">{formatCurrency(sale.change)}</p>
            </div>
          )}
          {sale.balanceDue > 0 && (
            <p className="text-sm font-medium text-warning">
              {formatCurrency(sale.balanceDue)} added to the customer&apos;s account.
            </p>
          )}
          <PermissionGate permission="invoice.print">
            <div className="grid grid-cols-2 gap-2">
              <PrintButton invoiceId={sale.invoiceId} invoiceNumber={sale.invoiceNumber} kind="receipt" label="Receipt" size="lg" />
              <PrintButton invoiceId={sale.invoiceId} invoiceNumber={sale.invoiceNumber} kind="invoice" label="Invoice" size="lg" />
            </div>
          </PermissionGate>
        </div>
      )}
    </Modal>
  );
}
