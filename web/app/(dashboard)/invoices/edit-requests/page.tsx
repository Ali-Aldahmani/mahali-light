'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, Mail, ShieldAlert } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Table, { type TableColumn } from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import RequirePermission from '@/components/guards/RequirePermission';
import { toast } from '@/store/toastStore';
import { useInvoiceStore } from '@/store/invoiceStore';
import { onInvoiceEditRequestEvent } from '@/store/socketStore';
import {
  listEditRequests,
  approveEditRequest,
  rejectEditRequest,
} from '@/services/invoiceEditRequestService';
import { formatDateTime } from '@/lib/utils/format';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function InvoiceEditRequestsPage() {
  return (
    <RequirePermission permission="invoice.edit_approve">
      <InvoiceEditRequestsPageContent />
    </RequirePermission>
  );
}

function InvoiceEditRequestsPageContent() {
  const router = useRouter();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<any>(null);
  const [rejectingId, setRejectingId] = useState<any>(null);
  const [reason, setReason] = useState('');

  const refreshEditCount = useInvoiceStore((s) => s.refreshEditRequestsCount);

  async function load() {
    setLoading(true);
    try {
      const { data } = await listEditRequests({ status: status || undefined });
      setRows(data || []);
    } catch (err: any) {
      toast.error(err?.message || 'Could not load edit requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    return onInvoiceEditRequestEvent(() => {
      load();
      refreshEditCount?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve(row: any) {
    setBusyId(row.id);
    try {
      await approveEditRequest(row.invoiceId, row.id);
      toast.success('Edit applied.');
      load();
      refreshEditCount?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not approve.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: any) {
    if (!reason.trim()) {
      toast.warning('Provide a reason.');
      return;
    }
    setBusyId(row.id);
    try {
      await rejectEditRequest(row.invoiceId, row.id, reason.trim());
      toast.success('Edit rejected.');
      setRejectingId(null);
      setReason('');
      load();
      refreshEditCount?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not reject.');
    } finally {
      setBusyId(null);
    }
  }

  const columns: TableColumn[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r: any) => (
        <button
          type="button"
          onClick={() => router.push(`/invoices/${r.invoiceId}`)}
          className="font-mono text-sm text-ink hover:text-accent text-left"
        >
          {r.invoiceNumber}
        </button>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (r: any) => (
        <span className="text-sm text-ink">{r.customerName || 'Guest'}</span>
      ),
    },
    {
      key: 'requestedBy',
      header: 'Requested by',
      render: (r: any) => (
        <div>
          <div className="text-sm text-ink">
            {r.requestedByUsername || '—'}
          </div>
          <div className="text-[11px] text-ink-muted">
            {formatDateTime(r.requestedAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'note',
      header: 'Note',
      render: (r: any) => (
        <div className="text-sm text-ink-muted max-w-[280px] truncate">
          {r.requestNote}
        </div>
      ),
    },
    {
      key: 'changes',
      header: 'Changes',
      render: (r: any) => <ChangeSummary changes={r.changes} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: any) => <StatusPill status={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      sortable: false,
      render: (r: any) =>
        r.status === 'pending' ? (
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejectingId(r.id);
                setReason('');
              }}
            >
              Reject
            </Button>
            <Button
              size="sm"
              leftIcon={<Check className="h-3.5 w-3.5" />}
              onClick={() => approve(r)}
              loading={busyId === r.id}
            >
              Approve
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Eye className="h-3.5 w-3.5" />}
            onClick={() => router.push(`/invoices/${r.invoiceId}`)}
          >
            View
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" />
            Invoice edit requests
          </span>
        }
        subtitle="Review and approve changes requested by cashiers."
      />

      <div className="flex items-center gap-3">
        <div className="w-48">
          <Select
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            searchable={false}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title="No edit requests"
            description="When cashiers submit edit requests, they'll appear here for review."
            icon={<Mail className="h-6 w-6" />}
          />
        }
      />

      {rejectingId && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface border border-border shadow-pop p-4 space-y-3">
            <div className="text-base font-semibold text-ink">
              Reject edit request
            </div>
            <Input
              label="Reason"
              required
              autoFocus
              value={reason}
              onChange={(e: any) => setReason(e.target.value)}
              placeholder="Explain why this edit is rejected"
            />
            <div className="flex items-center gap-2 justify-end pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setRejectingId(null);
                  setReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const row = rows.find((r) => r.id === rejectingId);
                  if (row) reject(row);
                }}
                loading={!!busyId}
              >
                Submit rejection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChangeSummary({ changes }: { changes: any }) {
  if (!changes) return <span className="text-xs text-ink-muted">—</span>;
  const parts: string[] = [];
  if (Array.isArray(changes.items)) {
    for (const it of changes.items) {
      parts.push(`Qty → ${it.quantity}`);
    }
  }
  if (changes.invoiceDiscount != null) {
    parts.push(`Discount → ${Number(changes.invoiceDiscount).toFixed(2)} AED`);
  }
  if (!parts.length) return <span className="text-xs text-ink-muted">—</span>;
  return (
    <div className="text-xs text-ink space-y-0.5 max-w-[220px]">
      {parts.slice(0, 3).map((p, i) => (
        <div key={i} className="truncate">{p}</div>
      ))}
      {parts.length > 3 && (
        <div className="text-ink-muted">+{parts.length - 3} more</div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const META: Record<string, string> = {
    pending: 'bg-warning-light text-warning',
    approved: 'bg-success-light text-success',
    rejected: 'bg-error-light text-error',
    cancelled: 'bg-surface-2 text-ink-muted',
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${META[status] || 'bg-surface-2 text-ink-muted'}`}
    >
      {status}
    </span>
  );
}
