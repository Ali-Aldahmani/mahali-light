// Display-only formatting for the phone screens (Figma shows whole amounts
// without trailing ".00"). Values always come from the API untouched.

export function formatAmount(value: unknown) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-AE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatAed(value: unknown) {
  return `AED ${formatAmount(value)}`;
}
