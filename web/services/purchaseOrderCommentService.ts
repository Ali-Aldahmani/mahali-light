import { apiGet, apiPost, apiDelete } from './http';
import { newRequestKey, withRequestKey } from '@/lib/requestKey';
import type { CommentReaction, ThreadComment } from '@/components/purchases/CommentThread';

export interface CreatePoCommentPayload {
  body: string;
  parentId?: string | null;
  requestKey?: string;
}

/**
 * List all comments for a purchase order (nested tree).
 */
export async function listPurchaseOrderComments(poId: string): Promise<ThreadComment[]> {
  return apiGet<ThreadComment[]>(`/purchase-orders/${poId}/comments`);
}

/**
 * Create a new comment or reply on a purchase order.
 */
export async function createPurchaseOrderComment(
  poId: string,
  payload: CreatePoCommentPayload,
): Promise<ThreadComment> {
  // newRequestKey also works on plain-HTTP LAN pages, where crypto.randomUUID is missing.
  const requestKey = payload.requestKey || newRequestKey();
  return apiPost<ThreadComment>(
    `/purchase-orders/${poId}/comments`,
    {
      body: payload.body,
      parentId: payload.parentId || null,
      requestKey,
    },
    withRequestKey(requestKey),
  );
}

/**
 * Toggle an emoji reaction on a purchase order comment.
 */
export async function togglePurchaseOrderReaction(
  poId: string,
  commentId: string,
  emoji: string,
  added?: boolean,
): Promise<{ commentId: string; reactions: CommentReaction[] }> {
  return apiPost<{ commentId: string; reactions: CommentReaction[] }>(
    `/purchase-orders/${poId}/comments/${commentId}/reactions`,
    { emoji, added },
  );
}

/**
 * Remove an emoji reaction on a purchase order comment.
 */
export async function removePurchaseOrderReaction(
  poId: string,
  commentId: string,
  emoji: string,
): Promise<{ commentId: string; reactions: CommentReaction[] }> {
  return apiDelete<{ commentId: string; reactions: CommentReaction[] }>(
    `/purchase-orders/${poId}/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`,
  );
}
