'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import { toast } from '@/store/toastStore';
import Skeleton from '@/components/ui/skeleton';
import Button from '@/components/ui/Button';
import CommentThread, {
  type CommentAuthor,
  type CommentReaction,
  type ThreadComment,
} from './CommentThread';
import {
  listPurchaseOrderComments,
  createPurchaseOrderComment,
  togglePurchaseOrderReaction,
} from '@/services/purchaseOrderCommentService';

interface PurchaseOrderCommentsProps {
  purchaseOrderId: string;
}

/* Helper to insert a comment into the nested tree */
function insertCommentIntoTree(
  tree: ThreadComment[],
  newComment: ThreadComment,
): ThreadComment[] {
  // If already present (prevent duplicate rendering), update in place
  const exists = (list: ThreadComment[]): boolean =>
    list.some((c) => c.id === newComment.id || (c.replies && exists(c.replies)));

  if (exists(tree)) {
    return tree.map((c) => {
      if (c.id === newComment.id) {
        return { ...c, ...newComment, replies: c.replies || newComment.replies || [] };
      }
      if (c.replies?.length) {
        return { ...c, replies: insertCommentIntoTree(c.replies, newComment) };
      }
      return c;
    });
  }

  // If root comment, append
  if (!newComment.parentId) {
    return [...tree, newComment];
  }

  // If child comment, attach to parent
  return tree.map((parent) => {
    if (parent.id === newComment.parentId) {
      return {
        ...parent,
        replies: [...(parent.replies || []), newComment],
      };
    }
    if (parent.replies?.length) {
      return {
        ...parent,
        replies: insertCommentIntoTree(parent.replies, newComment),
      };
    }
    return parent;
  });
}

/* Helper to update reactions of a comment in the tree */
function updateReactionsInTree(
  tree: ThreadComment[],
  commentId: string,
  reactions: CommentReaction[],
): ThreadComment[] {
  return tree.map((comment) => {
    if (comment.id === commentId) {
      return { ...comment, reactions };
    }
    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateReactionsInTree(comment.replies, commentId, reactions),
      };
    }
    return comment;
  });
}

/**
 * Format date/time into friendly relative or absolute label.
 */
function formatCommentTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return isoString;
  }
}

/**
 * Normalise raw API comment data into ThreadComment shape with formatted timestamps.
 */
function normaliseCommentTree(tree: any[]): ThreadComment[] {
  if (!Array.isArray(tree)) return [];
  return tree.map((item) => ({
    id: item.id,
    parentId: item.parentId || null,
    author: {
      id: item.author?.id || item.userId || item.id,
      name: item.author?.name || item.authorName || 'Employee',
      avatar: item.author?.avatar || undefined,
    },
    body: item.body,
    createdAt: formatCommentTime(item.createdAt),
    reactions: item.reactions || [],
    replies: normaliseCommentTree(item.replies || []),
  }));
}

export default function PurchaseOrderComments({ purchaseOrderId }: PurchaseOrderCommentsProps) {
  const user = useAuthStore((s: any) => s.user);
  const permissions = useAuthStore((s: any) => s.permissions) || [];

  const canView = permissions.includes('po.comments.view') || permissions.includes('*');
  const canCreate = permissions.includes('po.comments.create') || permissions.includes('*');
  const canReact = permissions.includes('po.comments.react') || permissions.includes('*');

  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const socket = useSocketStore((s) => s.socket);
  const isConnected = useSocketStore((s) => s.isConnected);

  const currentUser: CommentAuthor = useMemo(() => {
    return {
      id: String(user?.id || 'current-user'),
      name: user?.full_name || user?.username || 'You',
      avatar: user?.avatar_url || undefined,
    };
  }, [user]);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      setError(null);
      const data = await listPurchaseOrderComments(purchaseOrderId);
      setComments(normaliseCommentTree(data));
    } catch (err: any) {
      setError(err?.message || 'Failed to load comments.');
    } finally {
      setLoading(false);
    }
  }, [canView, purchaseOrderId]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Real-time synchronization
  useEffect(() => {
    if (!canView || !socket || !isConnected) return;

    // Join the scoped PO discussion room
    socket.emit('join_po_discussion', { poId: purchaseOrderId });

    const handleCommentCreated = (payload: any) => {
      if (payload?.poId !== purchaseOrderId || !payload.comment) return;
      const newComment: ThreadComment = {
        id: payload.comment.id,
        parentId: payload.comment.parentId || null,
        author: {
          id: payload.comment.author?.id || payload.comment.userId,
          name: payload.comment.author?.name || 'Employee',
          avatar: payload.comment.author?.avatar,
        },
        body: payload.comment.body,
        createdAt: formatCommentTime(payload.comment.createdAt),
        reactions: payload.comment.reactions || [],
        replies: [],
      };
      setComments((prev) => insertCommentIntoTree(prev, newComment));
    };

    const handleReactionUpdated = (payload: any) => {
      if (payload?.poId !== purchaseOrderId || !payload.commentId) return;
      setComments((prev) =>
        updateReactionsInTree(prev, payload.commentId, payload.reactions || []),
      );
    };

    socket.on('po_comment_created', handleCommentCreated);
    socket.on('po_comment_reaction_updated', handleReactionUpdated);

    // On reconnect, authoritative synchronization
    const handleConnect = () => {
      socket.emit('join_po_discussion', { poId: purchaseOrderId });
      load();
    };
    socket.on('connect', handleConnect);

    return () => {
      socket.emit('leave_po_discussion', { poId: purchaseOrderId });
      socket.off('po_comment_created', handleCommentCreated);
      socket.off('po_comment_reaction_updated', handleReactionUpdated);
      socket.off('connect', handleConnect);
    };
  }, [canView, socket, isConnected, purchaseOrderId, load]);

  // Handler for posting a new comment or reply
  const handleSubmitComment = async (body: string, parentId: string | null) => {
    if (!canCreate) {
      toast.error('You do not have permission to post comments.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createPurchaseOrderComment(purchaseOrderId, {
        body,
        parentId,
      });

      const formatted: ThreadComment = {
        id: created.id,
        parentId: created.parentId || null,
        author: {
          id: created.author?.id || currentUser.id,
          name: created.author?.name || currentUser.name,
          avatar: currentUser.avatar,
        },
        body: created.body,
        createdAt: 'Just now',
        reactions: created.reactions || [],
        replies: [],
      };

      // Optimistically reconcile authoritative server record
      setComments((prev) => insertCommentIntoTree(prev, formatted));
      toast.success('Comment posted.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit comment.');
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  // Handler for toggling reactions
  const handleToggleReaction = async (
    commentId: string,
    emoji: string,
    added: boolean,
  ) => {
    if (!canReact) {
      toast.error('You do not have permission to react to comments.');
      return;
    }
    try {
      const res = await togglePurchaseOrderReaction(
        purchaseOrderId,
        commentId,
        emoji,
        added,
      );
      setComments((prev) =>
        updateReactionsInTree(prev, commentId, res.reactions || []),
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update reaction.');
      // Refetch to ensure state consistency
      load();
    }
  };

  if (!canView) {
    return null;
  }

  if (loading) {
    return (
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold text-ink">Discussion</h2>
        </div>
        <Skeleton lines={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-ink-muted" />
            <h2 className="text-sm font-semibold text-ink">Discussion</h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => load()}
          >
            Retry
          </Button>
        </div>
        <div className="rounded-card border border-error/30 bg-error/10 p-4 text-xs text-error flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <CommentThread
      comments={comments}
      currentUser={currentUser}
      title="Discussion"
      placeholder="Write a comment or reply to this purchase order..."
      canCreate={canCreate}
      canReact={canReact}
      isSubmitting={submitting}
      onSubmitComment={handleSubmitComment}
      onToggleReaction={handleToggleReaction}
    />
  );
}
