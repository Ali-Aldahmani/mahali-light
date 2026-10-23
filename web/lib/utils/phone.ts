/**
 * Phone helpers shared by the phone field, duplicate checks and search.
 * New numbers are stored in international form ("+971501234567"); older
 * records may be local ("050 123 4567") or "00971…". These read all of them.
 */

/** Any stored phone as E.164, assuming the UAE for local numbers. '' when empty. */
export function toE164(raw?: string | null, defaultDial = '971'): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (text.startsWith('+')) return `+${text.replace(/\D/g, '')}`;
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith(defaultDial) && digits.length > 9) return `+${digits}`;
  if (digits.startsWith('0')) return `+${defaultDial}${digits.slice(1)}`;
  return `+${defaultDial}${digits}`;
}

/** True when two stored phones are the same number in different spellings. */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const x = toE164(a);
  const y = toE164(b);
  return !!x && x === y;
}
