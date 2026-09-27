'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

// Shown only when leaving with an unfinished sale — the cart is never
// dropped silently.
export default function CashierExitDialog({
  open,
  canHold,
  holding,
  onKeep,
  onHold,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  canHold: boolean;
  holding: boolean;
  onKeep: () => void;
  onHold: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={holding ? undefined : onCancel}
      title="Exit Cashier Mode?"
      subtitle="There is an unfinished sale on screen."
      size="sm"
    >
      <div className="grid gap-2">
        <Button size="touch" autoFocus onClick={onKeep} disabled={holding}>
          Keep sale &amp; exit
        </Button>
        {canHold && (
          <Button size="touch" variant="secondary" onClick={onHold} loading={holding}>
            Hold sale &amp; exit
          </Button>
        )}
        <Button size="touch" variant="danger" onClick={onDiscard} disabled={holding}>
          Discard sale &amp; exit
        </Button>
        <Button size="touch" variant="ghost" onClick={onCancel} disabled={holding}>
          Stay in Cashier Mode
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        “Keep” leaves the cart in the POS so you can continue it from the POS page. You stay signed in.
      </p>
    </Modal>
  );
}
