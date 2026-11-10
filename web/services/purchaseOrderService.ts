import http, { apiGet, apiGetWithMeta, apiPost, apiPut, apiDelete, uploadConfig, type UploadOptions } from './http';
import { withRequestKey } from '@/lib/requestKey';

function toParams(o: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
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
}: {
  page?: number;
  limit?: number;
  search?: string;
  supplierId?: string | number;
  status?: string;
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  overdue?: boolean | string;
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

export function createPurchaseOrder(body, requestKey?: string) {
  return apiPost('/purchase-orders', body, withRequestKey(requestKey));
}

export function updatePurchaseOrder(id, body) {
  return apiPut(`/purchase-orders/${id}`, body);
}

export function deletePurchaseOrder(id) {
  return apiDelete(`/purchase-orders/${id}`);
}

// Cancels a draft or confirmed PO that has nothing received or paid. The PO
// is kept with status 'cancelled' (server: purchaseOrdersController.cancelPo).
export function cancelPurchaseOrder(id, reason?: string | null) {
  return apiPost(`/purchase-orders/${id}/cancel`, { reason: reason || null });
}

export function confirmPurchaseOrder(id) {
  return apiPost(`/purchase-orders/${id}/confirm`, {});
}

// requestKey: see lib/requestKey — a retried partial receipt can't add the goods twice.
// deliveredAt: when the goods arrived (ISO), if not just now; deliveryNote:
// the supplier's delivery note number.
export function receivePurchaseOrderItems(
  id, items, requestKey?: string,
  extra: { deliveredAt?: string | null; deliveryNote?: string | null } = {},
) {
  return apiPost(`/purchase-orders/${id}/receive`, { items, ...extra }, withRequestKey(requestKey));
}

// Marks what the supplier will never deliver as cancelled; the order is then complete.
export function closePurchaseOrderRemainder(id, reason: string) {
  return apiPost(`/purchase-orders/${id}/close-remainder`, { reason });
}

// A delivery date the supplier gave. Kept as history; the first never changes.
export function recordSupplierPromise(id, promisedDate: string, note?: string | null) {
  return apiPost(`/purchase-orders/${id}/promises`, { promisedDate, note: note || null });
}

export async function uploadPurchaseOrderAttachment(id, file, opts?: UploadOptions) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post(`/purchase-orders/${id}/attachment`, fd, uploadConfig(opts));
  return res.data?.data;
}

export function deletePurchaseOrderAttachment(id) {
  return apiDelete(`/purchase-orders/${id}/attachment`);
}
