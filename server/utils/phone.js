// Phone numbers arrive in several spellings: new ones in international form
// ("+971501234567"), older ones local ("050 123 4567") or "00971…". These
// helpers let duplicate checks and search treat them as the same number.

const DEFAULT_DIAL = '971';

/** Any phone as international digits without the plus, assuming the UAE for local numbers. */
function phoneKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith(DEFAULT_DIAL) && digits.length > 9) return digits;
  if (digits.startsWith('0')) return DEFAULT_DIAL + digits.slice(1);
  return DEFAULT_DIAL + digits;
}

/**
 * The part of a typed search worth matching against stored digits: drops a
 * leading "+", "00", the UAE code and a trunk 0, so "050 12", "+971 50 12"
 * and "5012" all look for "5012". Empty when fewer than 3 digits remain.
 */
function phoneSearchCore(q) {
  let digits = String(q ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(DEFAULT_DIAL)) digits = digits.slice(DEFAULT_DIAL.length);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 3 ? digits : '';
}

/** SQL for a column's digits only, for comparing against phoneKey / phoneSearchCore. */
const digitsSql = (column) => `regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g')`;

module.exports = { phoneKey, phoneSearchCore, digitsSql };
