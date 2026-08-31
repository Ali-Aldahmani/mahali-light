const MAX = 20;
const SENSITIVE = new Set([
  'password',
  'token',
  'authorization',
  'credit_card',
  'card_number',
  'cvv',
  'pin',
]);

const breadcrumbs = [];

function redact(data) {
  if (!data || typeof data !== 'object') return data;
  const out = Array.isArray(data) ? [...data] : { ...data };
  for (const key of Object.keys(out)) {
    if (SENSITIVE.has(String(key).toLowerCase())) {
      out[key] = '[redacted]';
    }
  }
  return out;
}

export function addBreadcrumb(action, data = {}) {
  breadcrumbs.push({
    action,
    data: redact(data),
    at: new Date().toISOString(),
    screen: typeof window !== 'undefined' ? window.location.pathname : '',
  });
  while (breadcrumbs.length > MAX) breadcrumbs.shift();
}

export function getBreadcrumbs() {
  return breadcrumbs.slice(-10);
}

export function clearBreadcrumbs() {
  breadcrumbs.length = 0;
}
