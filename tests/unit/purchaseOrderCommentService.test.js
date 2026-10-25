import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commentService = require('../../server/services/purchaseOrderCommentService');
const commentController = require('../../server/controllers/purchaseOrderCommentsController');
const { requirePermission } = require('../../server/middleware/permissions');
const { ERROR_CODES } = require('../../shared/errorCodes');

describe('purchaseOrderCommentService unit tests', () => {
  describe('buildCommentTree', () => {
    it('correctly nests replies under their parents in chronological order', () => {
      const flat = [
        {
          id: 'c-1',
          purchase_order_id: 'po-1',
          user_id: 'u-1',
          author_name: 'Alice',
          parent_id: null,
          body: 'First root comment',
          created_at: '2026-10-25T10:00:00Z',
          reactions: [{ emoji: '👍', users: ['u-2'] }],
        },
        {
          id: 'c-2',
          purchase_order_id: 'po-1',
          user_id: 'u-2',
          author_name: 'Bob',
          parent_id: 'c-1',
          body: 'Reply to first comment',
          created_at: '2026-10-25T10:05:00Z',
          reactions: [],
        },
        {
          id: 'c-3',
          purchase_order_id: 'po-1',
          user_id: 'u-1',
          author_name: 'Alice',
          parent_id: 'c-2',
          body: 'Reply to reply',
          created_at: '2026-10-25T10:10:00Z',
          reactions: [],
        },
        {
          id: 'c-4',
          purchase_order_id: 'po-1',
          user_id: 'u-3',
          author_name: 'Charlie',
          parent_id: null,
          body: 'Second root comment',
          created_at: '2026-10-25T10:15:00Z',
          reactions: [],
        },
      ];

      const tree = commentService.buildCommentTree(flat);

      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('c-1');
      expect(tree[0].body).toBe('First root comment');
      expect(tree[0].author.name).toBe('Alice');
      expect(tree[0].reactions).toEqual([{ emoji: '👍', users: ['u-2'] }]);
      expect(tree[0].replies).toHaveLength(1);

      // Level 1 reply
      const reply = tree[0].replies[0];
      expect(reply.id).toBe('c-2');
      expect(reply.parentId).toBe('c-1');
      expect(reply.author.name).toBe('Bob');
      expect(reply.replies).toHaveLength(1);

      // Level 2 reply
      const nestedReply = reply.replies[0];
      expect(nestedReply.id).toBe('c-3');
      expect(nestedReply.parentId).toBe('c-2');
      expect(nestedReply.author.name).toBe('Alice');
      expect(nestedReply.replies).toHaveLength(0);

      // Second root comment
      expect(tree[1].id).toBe('c-4');
      expect(tree[1].replies).toHaveLength(0);
    });

    it('places comments with missing parent at root to prevent orphaned invisible data', () => {
      const flat = [
        {
          id: 'c-orphan',
          purchase_order_id: 'po-1',
          user_id: 'u-1',
          author_name: 'Alice',
          parent_id: 'nonexistent-parent',
          body: 'Orphan comment',
          created_at: '2026-10-25T10:00:00Z',
          reactions: [],
        },
      ];

      const tree = commentService.buildCommentTree(flat);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('c-orphan');
    });
  });

  describe('shapeComment', () => {
    it('shapes a database row into a standardized response structure', () => {
      const row = {
        id: 'c-1',
        purchase_order_id: 'po-1',
        parent_id: null,
        user_id: 'u-1',
        author_name: 'Test Employee',
        author_username: 'testemp',
        body: 'Hello world',
        created_at: '2026-10-25T10:00:00Z',
        reactions: [],
      };

      const shaped = commentService.shapeComment(row);
      expect(shaped).toEqual({
        id: 'c-1',
        purchaseOrderId: 'po-1',
        parentId: null,
        author: {
          id: 'u-1',
          name: 'Test Employee',
          username: 'testemp',
        },
        body: 'Hello world',
        createdAt: '2026-10-25T10:00:00Z',
        reactions: [],
        replies: [],
      });
    });
  });

  describe('immutability enforcement at controller layer', () => {
    it('does not export any update, edit, or delete functions for comments', () => {
      expect(commentController.update).toBeUndefined();
      expect(commentController.edit).toBeUndefined();
      expect(commentController.remove).toBeUndefined();
      expect(commentController.delete).toBeUndefined();
      expect(commentController.deleteComment).toBeUndefined();
      expect(commentController.softDelete).toBeUndefined();
    });
  });

  describe('permission middleware enforcement', () => {
    it('requirePermission allows users with po.comments.create', () => {
      let nextCalled = false;
      const middleware = requirePermission('po.comments.create');
      middleware(
        { user: { permissions: ['po.comments.create'] } },
        {},
        () => { nextCalled = true; },
      );
      expect(nextCalled).toBe(true);
    });

    it('requirePermission denies users missing po.comments.create', () => {
      let error = null;
      const middleware = requirePermission('po.comments.create');
      middleware(
        { user: { permissions: ['supplier.view', 'po.comments.view'] } },
        {},
        (err) => { error = err; },
      );
      expect(error?.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
      expect(error?.status).toBe(403);
      expect(error?.details?.missing).toEqual(['po.comments.create']);
    });

    it('requirePermission denies users missing po.comments.view', () => {
      let error = null;
      const middleware = requirePermission('po.comments.view');
      middleware(
        { user: { permissions: ['supplier.view'] } },
        {},
        (err) => { error = err; },
      );
      expect(error?.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
      expect(error?.status).toBe(403);
    });

    it('requirePermission denies users missing po.comments.react', () => {
      let error = null;
      const middleware = requirePermission('po.comments.react');
      middleware(
        { user: { permissions: ['po.comments.view'] } },
        {},
        (err) => { error = err; },
      );
      expect(error?.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
      expect(error?.status).toBe(403);
    });
  });
});
