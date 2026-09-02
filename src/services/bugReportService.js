import http from './http.js';
import { getBreadcrumbs } from './breadcrumbService.js';

const APP_VERSION = '1.2.0';

function collectDeviceInfo() {
  const electron = typeof window !== 'undefined' ? window.electron : null;
  return {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    language: navigator.language,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
    memory: navigator.deviceMemory,
    pcIdentifier: electron?.pcIdentifier || null,
  };
}

export async function captureScreenshot() {
  const electron = typeof window !== 'undefined' ? window.electron : null;
  if (electron?.captureScreenshot) {
    const base64 = await electron.captureScreenshot();
    return base64 || null;
  }
  return null;
}

export async function submitBugReport({
  whatWereYouDoing,
  whatHappened,
  urgency,
  errorCode = null,
  stackTrace = null,
  screenshotBase64 = null,
}) {
  const form = new FormData();
  form.append('what_were_you_doing', whatWereYouDoing);
  form.append('what_happened', whatHappened);
  form.append('urgency', urgency);
  form.append('screen', window.location.pathname);
  form.append('app_version', APP_VERSION);
  form.append('breadcrumbs', JSON.stringify(getBreadcrumbs()));
  form.append('device_info', JSON.stringify(collectDeviceInfo()));

  const electron = window.electron;
  if (electron?.pcIdentifier) {
    form.append('pc_identifier', electron.pcIdentifier);
  }
  if (errorCode) form.append('error_code', errorCode);
  if (stackTrace) form.append('stack_trace', stackTrace);

  if (screenshotBase64) {
    const bin = atob(screenshotBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    form.append('screenshot', new Blob([arr], { type: 'image/png' }), 'screenshot.png');
  }

  const res = await http.post('/bug-reports', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export async function listBugReports(params = {}) {
  const usp = new URLSearchParams(params);
  const res = await http.get(`/bug-reports?${usp}`);
  return { data: res.data?.data, meta: res.data?.meta };
}

export async function getBugReport(id) {
  const res = await http.get(`/bug-reports/${id}`);
  return res.data?.data;
}

export async function updateBugReport(id, patch) {
  const res = await http.put(`/bug-reports/${id}`, patch);
  return res.data?.data;
}

export async function addBugComment(id, comment) {
  const res = await http.post(`/bug-reports/${id}/comments`, { comment });
  return res.data?.data;
}
