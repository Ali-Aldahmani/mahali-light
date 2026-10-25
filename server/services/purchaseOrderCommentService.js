const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const MAX_NESTING_DEPTH = 3;

/**
 * Build a nested comment tree from flat DB rows.
 * Preserves deterministic chronological order (oldest first).
 */
function buildCommentTree(flatList) {
  const itemMap = new Map();
  const roots = [];

  for (const row of flatList) {
    itemMap.set(row.id, {
      id: row.id,
      purchaseOrderId: row.purchase_order_id,
      parentId: row.parent_id || null,
      author: {
        id: row.user_id || row.id,
        name: row.author_name || row.author_username || 'Unknown',
        username: row.author_username || null,
      },
      body: row.body,
      createdAt: row.created_at,
      reactions: row.reactions || [],
      replies: [],
    });
  }

  for (const item of itemMap.values()) {
    if (item.parentId && itemMap.has(item.parentId)) {
      itemMap.get(item.parentId).replies.push(item);
    } else {
      roots.push(item);
    }
  }

  return roots;
}

/**
 * Shape a single comment row for response/socket.
 */
function shapeComment(row) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    parentId: row.parent_id || null,
    author: {
      id: row.user_id || row.id,
      name: row.author_name || row.author_username || 'Unknown',
      username: row.author_username || null,
    },
    body: row.body,
    createdAt: row.created_at,
    reactions: row.reactions || [],
    replies: row.replies || [],
  };
}

/**
 * Retrieve aggregated reactions for a comment.
 */
async function getCommentReactions(commentId, client = null) {
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT emoji, array_agg(user_id::text ORDER BY created_at ASC) AS users
       FROM purchase_order_comment_reactions
      WHERE comment_id = $1
      GROUP BY emoji
      ORDER BY MIN(created_at) ASC`,
    [commentId],
  );
  return rows.map((r) => ({
    emoji: r.emoji,
    users: r.users || [],
  }));
}

/**
 * Verify that a purchase order exists.
 */
async function assertPoExists(poId, client = null) {
  const runner = client || { query };
  const { rows } = await runner.query(
    `SELECT id, po_number, status FROM purchase_orders WHERE id = $1`,
    [poId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Purchase order not found.', {
      status: 404,
    });
  }
  return rows[0];
}

/**
 * List all comments for a purchase order in hierarchical tree structure.
 */
async function listComments(poId) {
  await assertPoExists(poId);

  const { rows } = await query(
    `SELECT c.id, c.purchase_order_id, c.user_id, c.author_name, c.author_username,
            c.parent_id, c.body, c.created_at,
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'emoji', r.emoji,
                    'users', r.users
                  )
                )
                FROM (
                  SELECT emoji, array_agg(user_id::text ORDER BY created_at ASC) AS users
                    FROM purchase_order_comment_reactions
                   WHERE comment_id = c.id
                   GROUP BY emoji
                   ORDER BY MIN(created_at) ASC
                ) r
              ),
              '[]'::json
            ) AS reactions
       FROM purchase_order_comments c
      WHERE c.purchase_order_id = $1
      ORDER BY c.created_at ASC`,
    [poId],
  );

  return buildCommentTree(rows);
}

/**
 * Create a new comment or reply.
 */
async function createComment({
  poId,
  userId,
  authorName,
  authorUsername,
  body,
  parentId = null,
  requestKey = null,
  client = null,
}) {
  const runner = client || { query };

  await assertPoExists(poId, runner);

  // Parent validation
  if (parentId) {
    const { rows: parentRows } = await runner.query(
      `SELECT id, purchase_order_id, parent_id FROM purchase_order_comments WHERE id = $1`,
      [parentId],
    );
    if (!parentRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Parent comment not found.', {
        status: 404,
      });
    }
    const parent = parentRows[0];
    if (parent.purchase_order_id !== poId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Cross-PO reply references are not allowed.',
        { status: 400 },
      );
    }

    // Measure depth
    let depth = 1;
    let curr = parent;
    while (curr.parent_id) {
      depth++;
      if (depth >= MAX_NESTING_DEPTH) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `Maximum reply depth of ${MAX_NESTING_DEPTH} exceeded.`,
          { status: 400 },
        );
      }
      const { rows: ancRows } = await runner.query(
        `SELECT id, parent_id FROM purchase_order_comments WHERE id = $1`,
        [curr.parent_id],
      );
      if (!ancRows.length) break;
      curr = ancRows[0];
    }
  }

  const { rows } = await runner.query(
    `INSERT INTO purchase_order_comments
       (purchase_order_id, user_id, author_name, author_username, parent_id, body, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      poId,
      userId,
      authorName,
      authorUsername || null,
      parentId || null,
      body.trim(),
      requestKey || null,
    ],
  );

  const commentRow = rows[0];

  await logActivity({
    entityType: 'purchase_order',
    entityId: poId,
    action: parentId ? 'purchase_order.comment_replied' : 'purchase_order.comment_created',
    performedBy: userId,
    notes: `Comment ID: ${commentRow.id}`,
    client: runner,
  });

  return shapeComment({
    ...commentRow,
    reactions: [],
    replies: [],
  });
}

/**
 * Add or remove reaction to a comment.
 */
async function toggleReaction({ poId, commentId, userId, emoji, added = null }) {
  await assertPoExists(poId);

  const { rows: commentRows } = await query(
    `SELECT id, purchase_order_id FROM purchase_order_comments WHERE id = $1`,
    [commentId],
  );
  if (!commentRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Comment not found.', {
      status: 404,
    });
  }
  if (commentRows[0].purchase_order_id !== poId) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Comment does not belong to the specified purchase order.',
      { status: 400 },
    );
  }

  if (added === true) {
    await query(
      `INSERT INTO purchase_order_comment_reactions (comment_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (comment_id, user_id, emoji) DO NOTHING`,
      [commentId, userId, emoji],
    );
  } else if (added === false) {
    await query(
      `DELETE FROM purchase_order_comment_reactions
        WHERE comment_id = $1 AND user_id = $2 AND emoji = $3`,
      [commentId, userId, emoji],
    );
  } else {
    // Toggle
    const { rows: existing } = await query(
      `SELECT id FROM purchase_order_comment_reactions
        WHERE comment_id = $1 AND user_id = $2 AND emoji = $3`,
      [commentId, userId, emoji],
    );
    if (existing.length) {
      await query(
        `DELETE FROM purchase_order_comment_reactions WHERE id = $1`,
        [existing[0].id],
      );
    } else {
      await query(
        `INSERT INTO purchase_order_comment_reactions (comment_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, user_id, emoji) DO NOTHING`,
        [commentId, userId, emoji],
      );
    }
  }

  const updatedReactions = await getCommentReactions(commentId);
  return updatedReactions;
}

module.exports = {
  listComments,
  createComment,
  toggleReaction,
  getCommentReactions,
  buildCommentTree,
  shapeComment,
  assertPoExists,
};
