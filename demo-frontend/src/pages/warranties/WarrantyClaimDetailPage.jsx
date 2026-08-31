import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Wrench,
  Replace,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import ClaimResolutionBadge, {
  ClaimStatusBadge,
} from '../../components/ui/ClaimResolutionBadge.jsx';
import {
  getClaim,
  raiseSupplierClaim,
  setSupplierClaimResolved,
} from '../../services/warrantyClaimService.js';
import { toast } from '../../store/toastStore.js';
import { formatDate } from '../../utils/format.js';
import ResolveClaimSlideOver from './ResolveClaimSlideOver.jsx';

export default function WarrantyClaimDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [claim, setClaim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getClaim(id);
      setClaim(data);
    } catch (e) {
      toast.error(e?.error?.message || 'Could not load claim.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleRaiseSupplier() {
    try {
      await raiseSupplierClaim(id);
      toast.success('Supplier claim raised.');
      load();
    } catch (e) {
      toast.error(e?.error?.message || 'Could not update.');
    }
  }

  async function toggleSupplierResolved(resolved) {
    try {
      await setSupplierClaimResolved(id, resolved);
      toast.success(resolved ? 'Marked as resolved.' : 'Marked as pending.');
      load();
    } catch (e) {
      toast.error(e?.error?.message || 'Could not update.');
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-ink-muted">Loading claim…</div>;
  }
  if (!claim) return null;

  const ResolutionIcon =
    claim.resolution === 'replaced'
      ? Replace
      : claim.resolution === 'repaired'
        ? Wrench
        : claim.resolution === 'rejected'
          ? XCircle
          : CheckCircle2;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-accent" />
            <span className="font-mono text-2xl">{claim.claimNumber}</span>
          </span>
        }
        subtitle={
          <span>
            Warranty{' '}
            <Link
              to={`/warranties/${claim.warrantyId}`}
              className="text-accent hover:underline font-mono"
            >
              {claim.warrantyNumber}
            </Link>{' '}
            • {claim.productName}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {!['resolved', 'rejected'].includes(claim.status) && (
              <PermissionGate permission="warranty.claim">
                <Button variant="primary" onClick={() => setResolveOpen(true)}>
                  Resolve claim
                </Button>
              </PermissionGate>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <ClaimStatusBadge status={claim.status} />
            {claim.resolution && (
              <ClaimResolutionBadge resolution={claim.resolution} />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Claim date" value={formatDate(claim.claimDate)} />
            <Field
              label="Created by"
              value={`${claim.createdByUsername || '—'} • ${formatDate(claim.createdAt)}`}
            />
            {claim.resolvedDate && (
              <Field
                label="Resolved"
                value={`${formatDate(claim.resolvedDate)} • ${claim.resolvedByUsername || '—'}`}
              />
            )}
            {claim.replacementInvoiceNumber && (
              <Field
                label="Replacement invoice"
                value={
                  <Link
                    to={`/invoices/${claim.replacementInvoiceId}`}
                    className="text-accent hover:underline font-mono"
                  >
                    {claim.replacementInvoiceNumber}
                  </Link>
                }
              />
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-muted mt-2">
              Issue description
            </div>
            <p className="text-sm mt-1 whitespace-pre-wrap">
              {claim.issueDescription}
            </p>
          </div>
          {claim.notes && (
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-muted mt-2">
                Notes
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{claim.notes}</p>
            </div>
          )}
        </div>

        <div className="card p-5 space-y-3">
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Resolution summary
          </div>
          {claim.resolution ? (
            <div className="flex items-center gap-2">
              <ResolutionIcon className="h-5 w-5 text-accent" />
              <span className="font-medium capitalize">{claim.resolution}</span>
            </div>
          ) : (
            <div className="text-sm text-ink-muted">Not resolved yet.</div>
          )}
          <div className="border-t border-border my-2" />
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Supplier claim
          </div>
          <ToggleRow
            label="Raised with supplier"
            value={claim.supplierClaimRaised}
            onChange={() => handleRaiseSupplier()}
            disabledIfTrue
          />
          <ToggleRow
            label="Supplier resolved"
            value={claim.supplierClaimResolved}
            onChange={() => toggleSupplierResolved(!claim.supplierClaimResolved)}
          />
        </div>
      </div>

      <ResolveClaimSlideOver
        claim={claim}
        open={resolveOpen}
        onClose={(refresh) => {
          setResolveOpen(false);
          if (refresh) load();
        }}
      />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

function ToggleRow({ label, value, onChange, disabledIfTrue = false }) {
  const isOn = !!value;
  const isLocked = disabledIfTrue && isOn;
  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onChange}
      className={`flex items-center justify-between w-full text-left text-sm py-1.5 ${
        isLocked ? 'opacity-70 cursor-default' : 'hover:text-accent'
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex h-5 w-9 items-center rounded-full transition ${
          isOn ? 'bg-success' : 'bg-surface-2'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
            isOn ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}
