import { Fragment, type ReactNode } from 'react';

/**
 * Highlights matches of query within text safely.
 */
export function highlightText(text: string | null | undefined, query: string | undefined): ReactNode {
  if (!text) return '—';
  const value = String(text);
  const q = (query || '').trim();
  if (!q) return value;

  const lowerText = value.toLowerCase();
  const lowerQuery = q.toLowerCase();
  // A few letters (Turkish İ) change length when lowercased, which would put
  // the offsets below in the wrong place. Show those without a highlight.
  if (lowerText.length !== value.length) return value;

  const parts: ReactNode[] = [];
  let from = 0;
  let index = lowerText.indexOf(lowerQuery, from);
  while (index !== -1) {
    parts.push(
      <Fragment key={index}>
        {value.slice(from, index)}
        <mark className="rounded bg-accent/20 px-0.5 font-semibold text-accent">
          {value.slice(index, index + lowerQuery.length)}
        </mark>
      </Fragment>,
    );
    from = index + lowerQuery.length;
    index = lowerText.indexOf(lowerQuery, from);
  }
  if (parts.length === 0) return value;
  return (
    <>
      {parts}
      {value.slice(from)}
    </>
  );
}
