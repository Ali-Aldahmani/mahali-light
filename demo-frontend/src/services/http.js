import { handleMockRequest } from '../mock/mockApi.js';
import { toast } from '../store/toastStore.js';

export async function apiGet(url, config) {
  try {
    const res = await handleMockRequest('GET', url, null, config);
    return res.data;
  } catch (err) {
    console.warn('[Mock API GET Error]', url, err);
    toast.error(err.message || 'Mock request failed');
    throw err;
  }
}

export async function apiPost(url, body, config) {
  try {
    const res = await handleMockRequest('POST', url, body, config);
    return res.data;
  } catch (err) {
    console.warn('[Mock API POST Error]', url, err);
    toast.error(err.message || 'Mock request failed');
    throw err;
  }
}

export async function apiPut(url, body, config) {
  try {
    const res = await handleMockRequest('PUT', url, body, config);
    return res.data;
  } catch (err) {
    console.warn('[Mock API PUT Error]', url, err);
    toast.error(err.message || 'Mock request failed');
    throw err;
  }
}

export async function apiDelete(url, config) {
  try {
    const res = await handleMockRequest('DELETE', url, null, config);
    return res.data;
  } catch (err) {
    console.warn('[Mock API DELETE Error]', url, err);
    toast.error(err.message || 'Mock request failed');
    throw err;
  }
}

export async function apiGetWithMeta(url, config) {
  try {
    const res = await handleMockRequest('GET', url, null, config);
    return { data: res.data, meta: res.meta || { total: Array.isArray(res.data) ? res.data.length : 1 } };
  } catch (err) {
    console.warn('[Mock API GET-Meta Error]', url, err);
    toast.error(err.message || 'Mock request failed');
    throw err;
  }
}

const http = {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  delete: apiDelete,
  request: async (cfg) => {
    const method = (cfg.method || 'GET').toUpperCase();
    const res = await handleMockRequest(method, cfg.url, cfg.data, cfg);
    return { data: res };
  }
};

export default http;
