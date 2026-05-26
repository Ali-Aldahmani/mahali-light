const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const notificationService = require('../services/notificationService');
const approvalsService = require('../services/approvalsService');
const { logActivity } = require('../utils/activityLog');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors?.[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

// =======================================================================
// Listing + counts
// =======================================================================
async function list(req, res, next) {
  try {
    const parsed = z
      .object({
        page: z.coerce.number().min(1).max(500).optional(),
        limit: z.coerce.number().min(1).max(100).optional(),
        category: z.string().optional(),
        severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
        unread_only: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const data = await notificationService.listForUser({
      userId: req.user.id,
      role: req.user.role,
      page: parsed.page || 1,
      limit: parsed.limit || 30,
      category: parsed.category || null,
      severity: parsed.severity || null,
      unreadOnly: parsed.unread_only || false,
    });
    const unreadCount = await notificationService.getUnreadCount(req.user.id, req.user.role);
    ok(res, data, { unread_count: unreadCount });
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const count = await notificationService.getUnreadCount(req.user.id, req.user.role);
    ok(res, { count });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const count = await notificationService.markAsRead({
      notificationId: req.params.id,
      userId: req.user.id,
    });
    ok(res, { unread_count: count });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const updated = await notificationService.markAllAsRead({
      userId: req.user.id,
      role: req.user.role,
    });
    ok(res, { updated, unread_count: 0 });
  } catch (err) {
    next(err);
  }
}

async function dismissOne(req, res, next) {
  try {
    const isAdmin = req.user.role === 'Admin';
    await notificationService.dismiss({
      notificationId: req.params.id,
      userId: req.user.id,
      isAdmin,
    });
    ok(res, { ok: true });
  } catch (err) {
    if (err.code === 'CANNOT_DISMISS_CRITICAL') {
      return next(
        new AppError(ERROR_CODES.AUTH_NO_PERMISSION, err.message, { status: 403 }),
      );
    }
    next(err);
  }
}

// =======================================================================
// Preferences
// =======================================================================
async function getPreferences(req, res, next) {
  try {
    const prefs = await notificationService.getPreferences(req.user.id);
    ok(res, prefs);
  } catch (err) {
    next(err);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const schema = z.object(
      Object.fromEntries(
        notificationService.ALL_FLAGS.map((flag) => [flag, z.boolean().optional()]),
      ),
    );
    const parsed = schema.parse(req.body || {});
    const prefs = await notificationService.updatePreferences(req.user.id, parsed);
    ok(res, prefs);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Admin broadcast
// =======================================================================
async function broadcast(req, res, next) {
  try {
    const parsed = z
      .object({
        title: z.string().min(1).max(200),
        message: z.string().min(1),
        severity: z.enum(['info', 'warning', 'error', 'critical']).default('info'),
        target_roles: z.array(z.string()).optional(),
        target_user_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body || {});

    const notif = await notificationService.createNotification({
      type: 'system.broadcast',
      category: 'system',
      title: parsed.title,
      message: parsed.message,
      severity: parsed.severity,
      isBroadcast: !parsed.target_roles && !parsed.target_user_ids,
      targetRoles: parsed.target_roles || null,
      targetUserIds: parsed.target_user_ids || null,
      createdBy: req.user.id,
    });
    await logActivity({
      entityType: 'notification',
      entityId: notif.id,
      action: 'notification.broadcast_sent',
      performedBy: req.user.id,
      newValue: parsed,
    });
    ok(res, notif);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Approval queue
// =======================================================================
async function approvalCounts(req, res, next) {
  try {
    ok(res, await approvalsService.getCounts());
  } catch (err) {
    next(err);
  }
}

async function approvalQueue(req, res, next) {
  try {
    const limit = Number(req.query.limit) || 10;
    ok(res, await approvalsService.getQueue({ limit }));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  dismissOne,
  getPreferences,
  updatePreferences,
  broadcast,
  approvalCounts,
  approvalQueue,
};
