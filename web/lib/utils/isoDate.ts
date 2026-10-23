/**
 * 'YYYY-MM-DD' <-> Date, in the viewer's local calendar (no UTC shift:
 * new Date('2026-10-23') would be midnight UTC, i.e. the 22nd in some zones).
 */
export function dateFromIso(value?: string | null): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isoFromDate(date?: Date | null): string {
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
