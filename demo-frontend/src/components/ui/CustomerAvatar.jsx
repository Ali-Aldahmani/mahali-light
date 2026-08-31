import Avatar from './Avatar.jsx';

// Thin wrapper around Avatar so we can evolve customer-specific styling
// (e.g. ring colour for credit holders) without touching every callsite.
// Uses the customer's `companyName` (when present) to pick the initials so
// businesses show "FE" rather than the contact person's letters.
export default function CustomerAvatar({ customer, size = 'md', className = '' }) {
  if (!customer) return <Avatar name="Guest" size={size} className={className} />;
  const label = customer.companyName || customer.name;
  return <Avatar name={label} size={size} className={className} />;
}
