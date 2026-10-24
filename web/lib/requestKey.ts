// Request keys make money and stock commands safe to retry (server migration
// 040). A form creates one key when it opens and sends it with every attempt;
// if a response is lost and the user submits again, the server recognises the
// key and returns the first result instead of paying or moving stock twice.

// crypto.randomUUID is missing on plain-HTTP LAN pages (not a secure context).
export function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}-${rand()}`;
}

// Axios request config that carries the key, or nothing when there is none.
export function withRequestKey(requestKey?: string | null) {
  return requestKey ? { headers: { 'Idempotency-Key': requestKey } } : undefined;
}
