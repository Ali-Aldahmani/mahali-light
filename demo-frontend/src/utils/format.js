import { TIMEZONE } from '../config.js';

export function formatDateTime(value, options = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value) {
  if (!value) return '—';
  // Accept "09:00" / "09:00:00" / Date / ISO strings.
  if (typeof value === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
    return value.slice(0, 5);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - date.getTime();
  const secs = Math.round(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Format a numeric quantity, dropping trailing zeros so 5.00 -> "5".
export function formatQty(value, { fractionDigits = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(fractionDigits).replace(/\.?0+$/, '');
}

// Shared number formatting: hide the .00 for whole amounts, but keep
// fils when they're non-zero (e.g. 8,450 vs 184,500.50).
function formatAmount(n) {
  const rounded = Math.round(n * 100) / 100;
  const hasFils = Math.abs(rounded % 1) > 0.001;
  return rounded.toLocaleString('en-AE', {
    minimumFractionDigits: hasFils ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

// Format AED amounts. Used for plain-text contexts (CSV export, toasts,
// native dialogs, chart tooltips) that can't render the Dirham glyph — JSX
// UI should prefer the <Money> component instead so the symbol renders.
export function formatCurrency(value, { currency = 'AED' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${currency} 0`;
  return `${currency} ${formatAmount(n)}`;
}

// Same formatting as formatCurrency but without the "AED" prefix, for
// pairing with the <Money>/<DirhamSymbol> glyph in JSX.
export function formatCurrencyNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return formatAmount(n);
}

// Alias used by Phase 3 stock UIs.
export const formatRelativeTime = timeAgo;
