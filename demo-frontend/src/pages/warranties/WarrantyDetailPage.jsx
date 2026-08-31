import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Shield,
  ArrowLeft,
  User,
  Package,
  ShieldOff,
  Receipt,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import WarrantyStatusBadge from '../../components/ui/WarrantyStatusBadge.jsx';
import DaysRemainingBadge from '../../components/ui/DaysRemainingBadge.jsx';
import ClaimResolutionBadge, {
  ClaimStatusBadge,
} from '../../components/ui/ClaimResolutionBadge.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { getWarranty, voidWarranty } from '../../services/warrantyService.js';
import { toast } from '../../store/toastStore.js';
import { formatDate } from '../../utils/format.js';
import RaiseClaimSlideOver from './RaiseClaimSlideOver.jsx';

export default function WarrantyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [warranty, setWarranty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claimOpen, setClaimOpen] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getWarranty(id);
      setWarranty(data);
    } catch (e) {
      toast.error(e?.error?.message || 'Could not load warranty.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleVoid() {
    setVoidConfirm(false);
    try {
      await voidWarranty(id);
      toast.success('Warranty voided.');
      load();
    } catch (e) {
      toast.error(e?.error?.message || 'Could not void warranty.');
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-ink-muted">Loading warranty…</div>
    );
  }
  if (!warranty) return null;

  const claimColumns = [
    {
      key: 'claim',
      header: 'Claim',
      render: (row) => (
        <Link to={`/warranty-claims/${row.id}`} className="font-mono text-xs text-accent hover:underline">
          {row.claimNumber}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDate(row.claimDate),
    },
    {
      key: 'issue',
      header: 'Issue',
      render: (row) => (
        <span className="text-sm line-clamp-2 max-w-[400px] block">
          {row.issueDescription}
        </span>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      render: (row) =>
        row.resolution ? (
          <ClaimResolutionBadge resolution={row.resolution} size="sm" />
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <ClaimStatusBadge status={row.status} size="sm" />,
    },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-accent" />
            <span className="font-mono text-2xl">{warranty.warrantyNumber}</span>
          </span>
        }
        subtitle={warranty.productName}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            {warranty.status === 'active' && (
              <PermissionGate permission="warranty.claim">
                <Button variant="primary" onClick={() => setClaimOpen(true)}>
                  Raise claim
                </Button>
              </PermissionGate>
            )}
            {warranty.status === 'active' && (
              <PermissionGate permission="warranty.create">
                <Button
                  variant="secondary"
                  onClick={() => setVoidConfirm(true)}
                  leftIcon={<ShieldOff className="h-4 w-4" />}
                >
                  Void
                </Button>
              </PermissionGate>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <WarrantyStatusBadge
              status={warranty.status}
              expiringSoon={warranty.expiringSoon}
            />
            {warranty.status === 'active' && (
              <DaysRemainingBadge daysRemaining={warranty.daysRemaining} />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Type" value={warranty.warrantyType} />
            <Field label="Duration" value={`${warranty.durationMonths} months`} />
            <Field label="Start" value={formatDate(warranty.startDate)} />
            <Field label="End" value={formatDate(warranty.endDate)} />
            <Field label="Serial" value={warranty.serialNumber || '—'} mono />
            <Field
              label="Created"
              value={`${formatDate(warranty.createdAt)} • ${warranty.createdByUsername || '—'}`}
            />
            {warranty.voidedAt && (
              <Field
                label="Voided"
                value={`${formatDate(warranty.voidedAt)}${warranty.voidReason ? ` — ${warranty.voidReason}` : ''}`}
              />
            )}
          </div>
          {warranty.terms && (
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-muted mt-2">
                Coverage terms
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{warranty.terms}</p>
            </div>
          )}
        </div>

        <div className="card p-5 space-y-3">
          <div className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-2">
            <Package className="h-3.5 w-3.5" /> Product
          </div>
          <div className="text-sm font-medium">{warranty.productName || '—'}</div>
          {warranty.variantSku && (
            <div className="text-xs text-ink-muted font-mono">
              {warranty.variantSku}
            </div>
          )}
          <div className="border-t border-border my-2" />
          <div className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-2">
            <User className="h-3.5 w-3.5" /> Customer
          </div>
          {warranty.customerId ? (
            <Link
              to={`/customers/${warranty.customerId}`}
              className="text-sm text-accent hover:underline"
            >
              {warranty.customerName || warranty.customerId}
            </Link>
          ) : (
            <div className="text-sm text-ink-muted">Walk-in / guest</div>
          )}
          {warranty.customerPhone && (
            <div className="text-xs text-ink-muted">{warranty.customerPhone}</div>
          )}
          <div className="border-t border-border my-2" />
          <div className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-2">
            <Receipt className="h-3.5 w-3.5" /> Invoice
          </div>
          {warranty.invoiceId ? (
            <Link
              to={`/invoices/${warranty.invoiceId}`}
              className="text-sm text-accent hover:underline font-mono"
            >
              {warranty.invoiceNumber}
            </Link>
          ) : (
            <div className="text-sm text-ink-muted">Manual record</div>
          )}
        </div>
      </div>

      {warranty.supplierWarranty && (
        <div className="card p-5 mb-6 border-l-4 border-accent">
          <div className="text-xs uppercase tracking-wider text-ink-muted mb-2">
            Linked supplier warranty
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link
                to={`/warranties/${warranty.supplierWarranty.id}`}
                className="font-mono text-sm text-accent hover:underline"
              >
                {warranty.supplierWarranty.warrantyNumber}
              </Link>
              <div className="text-xs text-ink-muted">
                {warranty.supplierWarranty.supplierName || 'Supplier'} •
                Expires {formatDate(warranty.supplierWarranty.endDate)}
              </div>
            </div>
            <WarrantyStatusBadge
              status={warranty.supplierWarranty.status}
              expiringSoon={warranty.supplierWarranty.expiringSoon}
            />
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Claims history</h2>
          {warranty.status === 'active' && (
            <PermissionGate permission="warranty.claim">
              <Button size="sm" variant="secondary" onClick={() => setClaimOpen(true)}>
                Raise new claim
              </Button>
            </PermissionGate>
          )}
        </div>
        <Table
          columns={claimColumns}
          rows={warranty.claims || []}
          onRowClick={(row) => navigate(`/warranty-claims/${row.id}`)}
          empty={
            <div className="text-center text-ink-muted py-8 text-sm">
              No claims raised against this warranty.
            </div>
          }
        />
      </div>

      <RaiseClaimSlideOver
        open={claimOpen}
        warranty={warranty}
        onClose={(refresh) => {
          setClaimOpen(false);
          if (refresh) load();
        }}
      />

      <ConfirmDialog
        open={voidConfirm}
        title="Void warranty?"
        description="Voiding will block any new claims for this warranty. This action cannot be undone."
        confirmLabel="Void warranty"
        variant="danger"
        onConfirm={handleVoid}
        onClose={() => setVoidConfirm(false)}
      />
    </div>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={`text-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
