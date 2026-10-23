const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const telegramService = require('../services/telegramService');

const updateSchema = z.object({
  botToken: z.string().max(200).optional(),
  chatId: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
});

function zodFail(err) {
  return new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors?.[0]?.message || 'Invalid request.', {
    status: 400,
    details: err.errors,
  });
}

async function get(_req, res, next) {
  try {
    ok(res, await telegramService.getSettings());
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const data = await telegramService.updateSettings(body, req.user.id);
    await logActivity({
      entityType: 'settings',
      entityId: null,
      action: 'settings.telegram_updated',
      performedBy: req.user.id,
      // Never log the token itself.
      newValue: {
        tokenChanged: body.botToken !== undefined,
        chatId: data.chatId,
        enabled: data.enabled,
      },
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function detectChat(req, res, next) {
  try {
    ok(res, await telegramService.detectChat(req.user.id));
  } catch (err) {
    next(err);
  }
}

async function test(_req, res, next) {
  try {
    ok(res, await telegramService.sendTestMessage());
  } catch (err) {
    next(err);
  }
}

module.exports = { get, update, detectChat, test };
