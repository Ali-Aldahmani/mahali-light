import { apiGet, apiPost, apiPut, apiGetWithMeta } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listNotifications(params) {
  return apiGetWithMeta(`/notifications${qs(params)}`);
}

export function getUnreadCount() {
  return apiGet(`/notifications/unread-count`);
}

export function markRead(id) {
  return apiPut(`/notifications/${id}/read`, {});
}

export function markAllRead() {
  return apiPut(`/notifications/read-all`, {});
}

export function dismissNotification(id) {
  return apiPut(`/notifications/${id}/dismiss`, {});
}

export function getPreferences() {
  return apiGet(`/notifications/preferences`);
}

export function updatePreferences(patch) {
  return apiPut(`/notifications/preferences`, patch);
}

export function getApprovalCounts() {
  return apiGet(`/notifications/approvals/counts`);
}

export function getApprovalQueue(limit = 10) {
  return apiGet(`/notifications/approvals/queue${qs({ limit })}`);
}

export function broadcast(payload) {
  return apiPost(`/notifications/broadcast`, payload);
}
