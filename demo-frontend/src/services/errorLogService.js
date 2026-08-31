import { apiGet, apiGetWithMeta, apiPut, apiDelete } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function listErrorLogs(params) {
  return apiGetWithMeta(`/error-logs${qs(params)}`);
}

export async function getErrorLog(id) {
  return apiGet(`/error-logs/${id}`);
}

export async function resolveErrorLog(id, resolutionNote) {
  return apiPut(`/error-logs/${id}/resolve`, {
    resolution_note: resolutionNote,
  });
}

export async function cleanupErrorLogs(days = 90) {
  return apiDelete(`/error-logs/cleanup?days=${days}`);
}
