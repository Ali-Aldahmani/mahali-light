import http from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function listErrorLogs(params) {
  const res = await http.get(`/error-logs${qs(params)}`);
  return { data: res.data?.data, meta: res.data?.meta };
}

export async function getErrorLog(id) {
  const res = await http.get(`/error-logs/${id}`);
  return res.data?.data;
}

export async function resolveErrorLog(id, resolutionNote) {
  const res = await http.put(`/error-logs/${id}/resolve`, {
    resolution_note: resolutionNote,
  });
  return res.data?.data;
}

export async function cleanupErrorLogs(days = 90) {
  const res = await http.delete(`/error-logs/cleanup?days=${days}`);
  return res.data?.data;
}
