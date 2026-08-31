import http, { apiGet, apiGetWithMeta, apiPost, apiPut, apiDelete } from './http.js';

function toParams(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listPurchaseOrders({
  page = 1,
  limit = 25,
  search,
  supplierId,
  status,
  paymentStatus,
  dateFrom,
  dateTo,
  overdue,
} = {}) {
  return apiGetWithMeta(
    `/purchase-orders?${toParams({
      page,
      limit,
      search,
      supplierId,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      overdue,
    })}`,
  );
}

export function getPurchaseOrder(id) {
  return apiGet(`/purchase-orders/${id}`);
}

export function createPurchaseOrder(body) {
  return apiPost('/purchase-orders', body);
}

export function updatePurchaseOrder(id, body) {
  return apiPut(`/purchase-orders/${id}`, body);
}

export function deletePurchaseOrder(id) {
  return apiDelete(`/purchase-orders/${id}`);
}

export function confirmPurchaseOrder(id) {
  return apiPost(`/purchase-orders/${id}/confirm`, {});
}

export function receivePurchaseOrderItems(id, items) {
  return apiPost(`/purchase-orders/${id}/receive`, { items });
}

export async function uploadPurchaseOrderAttachment(id, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post(`/purchase-orders/${id}/attachment`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export function deletePurchaseOrderAttachment(id) {
  return apiDelete(`/purchase-orders/${id}/attachment`);
}
