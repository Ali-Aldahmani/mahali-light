const { z } = require('zod');
const { ok, created } = require('../utils/response');
const { withTransaction } = require('../db/postgres');
const { runOnce, requestKeyFrom } = require('../utils/operations');
const commentService = require('../services/purchaseOrderCommentService');

const idParamSchema = z.string().uuid('Invalid purchase order identifier.');
const commentIdParamSchema = z.string().uuid('Invalid comment identifier.');

const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty.')
    .max(5000, 'Comment cannot exceed 5000 characters.'),
  parentId: z.string().uuid('Invalid parent comment identifier.').optional().nullable(),
  requestKey: z.string().max(128).optional().nullable(),
});

const reactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1, 'Emoji is required.')
    .max(32, 'Emoji must be at most 32 characters.'),
  added: z.boolean().optional(),
});

/**
 * List comments for a purchase order (hierarchical tree).
 */
async function list(req, res, next) {
  try {
    const poId = idParamSchema.parse(req.params.id);
    const comments = await commentService.listComments(poId);
    return ok(res, comments);
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new comment or reply (with idempotency support).
 */
async function create(req, res, next) {
  try {
    const poId = idParamSchema.parse(req.params.id);
    const body = createCommentSchema.parse(req.body || {});
    const requestKey = requestKeyFrom(req);

    const authorName =
      req.user.full_name || req.user.username || 'Employee';
    const authorUsername = req.user.username || null;

    const result = await withTransaction(async (client) => {
      const { result: comment } = await runOnce(
        client,
        {
          scope: `po_comment:${poId}`,
          key: requestKey,
          payload: { poId, body: body.body, parentId: body.parentId || null },
          userId: req.user.id,
        },
        () =>
          commentService.createComment({
            poId,
            userId: req.user.id,
            authorName,
            authorUsername,
            body: body.body,
            parentId: body.parentId || null,
            requestKey,
            client,
          }),
      );
      return comment;
    });

    // Real-time broadcast scoped to PO room after successful database commit
    const io = req.app.get('io');
    if (io) {
      io.to(`po_discussion:${poId}`).emit('po_comment_created', {
        poId,
        comment: result,
      });
    }

    return created(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * Add or toggle an emoji reaction on a comment.
 */
async function react(req, res, next) {
  try {
    const poId = idParamSchema.parse(req.params.id);
    const commentId = commentIdParamSchema.parse(req.params.commentId);
    const body = reactionSchema.parse(req.body || {});

    const reactions = await commentService.toggleReaction({
      poId,
      commentId,
      userId: req.user.id,
      emoji: body.emoji,
      added: body.added,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`po_discussion:${poId}`).emit('po_comment_reaction_updated', {
        poId,
        commentId,
        reactions,
      });
    }

    return ok(res, { commentId, reactions });
  } catch (err) {
    next(err);
  }
}

/**
 * Explicitly remove an emoji reaction.
 */
async function removeReaction(req, res, next) {
  try {
    const poId = idParamSchema.parse(req.params.id);
    const commentId = commentIdParamSchema.parse(req.params.commentId);
    const emoji = decodeURIComponent(req.params.emoji);

    const reactions = await commentService.toggleReaction({
      poId,
      commentId,
      userId: req.user.id,
      emoji,
      added: false,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`po_discussion:${poId}`).emit('po_comment_reaction_updated', {
        poId,
        commentId,
        reactions,
      });
    }

    return ok(res, { commentId, reactions });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  react,
  removeReaction,
};
