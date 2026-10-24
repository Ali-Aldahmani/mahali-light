// Success message for the New Purchase Order wizard. It describes what
// actually happened, so a payment that failed is never announced as recorded
// (the wizard shows a separate warning for that).
export function newPoSavedMessage({
  asDraft,
  poNumber,
  received,
  paymentRecorded,
}: {
  asDraft: boolean;
  poNumber: string;
  received: boolean;
  paymentRecorded: boolean;
}): string {
  if (asDraft) return 'PO saved as draft.';
  if (received && paymentRecorded) return `PO ${poNumber} confirmed, received, and payment recorded.`;
  if (paymentRecorded) return `PO ${poNumber} confirmed and payment recorded.`;
  if (received) return `PO ${poNumber} confirmed and received.`;
  return `PO ${poNumber} confirmed.`;
}
