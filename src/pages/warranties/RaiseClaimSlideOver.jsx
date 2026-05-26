import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import WarrantyStatusBadge from '../../components/ui/WarrantyStatusBadge.jsx';
import { createClaim } from '../../services/warrantyClaimService.js';
import { toast } from '../../store/toastStore.js';

export default function RaiseClaimSlideOver({ warranty, open, onClose }) {
  const navigate = useNavigate();
  const [issue, setIssue] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setIssue('');
    setNotes('');
    setSubmitting(false);
  }

  async function submit() {
    if (!warranty) return;
    if (!issue.trim()) {
      toast.error('Please describe the issue.');
      return;
    }
    setSubmitting(true);
    try {
      const claim = await createClaim({
        warrantyId: warranty.id,
        customerId: warranty.customerId,
        issueDescription: issue.trim(),
        notes: notes.trim() || null,
      });
      toast.success(`Claim ${claim.claimNumber} created.`);
      reset();
      onClose?.(true);
      navigate(`/warranty-claims/${claim.id}`);
    } catch (e) {
      toast.error(e?.error?.message || e.message || 'Could not create claim.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={() => {
        reset();
        onClose?.(false);
      }}
      title="Raise warranty claim"
      subtitle={warranty?.warrantyNumber}
      footer={
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose?.(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} variant="primary">
            {submitting ? 'Creating…' : 'Create claim'}
          </Button>
        </div>
      }
    >
      {warranty && (
        <div className="px-6 py-5 space-y-4">
          <div className="card p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-xs text-ink-muted">
                {warranty.warrantyNumber}
              </div>
              <WarrantyStatusBadge
                status={warranty.status}
                expiringSoon={warranty.expiringSoon}
              />
            </div>
            <div className="text-sm font-medium">{warranty.productName}</div>
            {warranty.serialNumber && (
              <div className="text-xs text-ink-muted font-mono">
                SN: {warranty.serialNumber}
              </div>
            )}
            {warranty.customerName && (
              <div className="text-xs text-ink-muted">
                Customer: {warranty.customerName}
              </div>
            )}
          </div>

          <Textarea
            label="Issue description"
            required
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="What is wrong with the product?"
            rows={5}
          />
          <Textarea
            label="Internal notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional context for managers"
            rows={3}
          />
        </div>
      )}
    </SlideOver>
  );
}
