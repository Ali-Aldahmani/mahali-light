const { z } = require('zod');
const { ok, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const errorLogService = require('../services/errorLogService');
const { getRecentEscalations } = require('../services/escalationService');
const { logActivity } = require('../utils/activityLog');

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 50 });
    const result = await errorLogService.listErrors({
      page,
      limit,
      offset,
      code: req.query.code || null,
      severity: req.query.severity || null,
      resolved: req.query.resolved,
      search: req.query.search || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    ok(res, result.rows, {
      pagination: { page, limit, total: result.total },
      summary: await errorLogService.getSummary(),
      escalations: await getRecentEscalations(),
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const row = await errorLogService.getErrorById(req.params.id);
    if (!row) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    ok(res, row);
  } catch (err) {
    next(err);
  }
}

const resolveSchema = z.object({
  resolution_note: z.string().max(2000).optional(),
});

async function resolve(req, res, next) {
  try {
    const body = resolveSchema.parse(req.body || {});
    const row = await errorLogService.resolveError(req.params.id, {
      resolvedBy: req.user.id,
      resolutionNote: body.resolution_note,
    });
    if (!row) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    await logActivity({
      entityType: 'error_log',
      entityId: row.id,
      action: 'error.resolved',
      performedBy: req.user.id,
      newValue: { code: row.code },
    });
    ok(res, row);
  } catch (err) {
    next(err);
  }
}

async function cleanup(req, res, next) {
  try {
    const days = Number(req.query.days) || 90;
    const result = await errorLogService.cleanupResolvedOlderThan(days);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, resolve, cleanup };
