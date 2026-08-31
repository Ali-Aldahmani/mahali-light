import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';
import { toast } from '../store/toastStore.js';

export async function captureScreenshot() {
  return null;
}

export async function submitBugReport({ whatWereYouDoing, whatHappened, urgency }) {
  toast.success('Bug report submitted to in-memory admin queue.');
  return apiPost('/admin/bug-reports', {
    title: whatWereYouDoing || 'Reported Issue',
    description: whatHappened,
    urgency,
  });
}

export async function listBugReports(params = {}) {
  const usp = new URLSearchParams();
  if (params.status) usp.set('status', params.status);
  if (params.limit) usp.set('limit', params.limit);
  const qs = usp.toString();
  return apiGetWithMeta(`/admin/bug-reports${qs ? `?${qs}` : ''}`);
}

export async function getBugReport(id) {
  return apiGet(`/admin/bug-reports/${id}`);
}

export async function updateBugReport(id, patch) {
  toast.success('Report status updated');
  return apiPut(`/admin/bug-reports/${id}`, patch);
}

export async function addBugComment(id, comment) {
  toast.success('Comment added');
  return apiPost(`/admin/bug-reports/${id}/comments`, { comment });
}
