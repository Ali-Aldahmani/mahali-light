import DirhamSymbol from './DirhamSymbol.jsx';
import { formatCurrencyNumber } from '../../utils/format.js';

// Renders a currency amount with the UAE Dirham glyph in place of the "AED"
// text prefix. Drop-in replacement for `{formatCurrency(value)}` in JSX.
export default function Money({ value, className = '', prefix = '', suffix = '' }) {
  return (
    <span className={className}>
      {prefix}
      <DirhamSymbol />
      {' '}
      {formatCurrencyNumber(value)}
      {suffix}
    </span>
  );
}
