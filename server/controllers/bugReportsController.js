const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const bugReportService = require('../services/bugReportService');
const { logActivity } = require('../utils/activityLog');

function headerPc(req) {
  return req.headers['x-pc-identifier'] || req.headers['x-pc-id'] || null;
}

function parseJsonField(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (_e) {
    return fallback;
  }
}

const submitSchema = z.object({
  what_were_you_doing: z.string().min(3).max(2000),
  what_happened: z.string().min(3).max(4000),
  urgency: z.enum(['blocking', 'major', 'minor']),
  screen: z.string().max(200).optional(),
  app_version: z.string().max(20).optional(),
  os_info: z.string().max(100).optional(),
  pc_identifier: z.string().max(50).optional(),
  error_code: z.string().max(100).optional(),
  stack_trace: z.string().max(20000).optional(),
  breadcrumbs: z.any().optional(),
  device_info: z.any().optional(),
});

async function submit(req, res, next) {
  try {
    const body = submitSchema.parse(req.body || {});
    const report = await bugReportService.createBugReport({
      reportedBy: req.user?.id || null,
      pcIdentifier: body.pc_identifier || headerPc(req),
      appVersion: body.app_version || req.headers['x-app-version'] || null,
      osInfo: body.os_info || null,
      screen: body.screen || null,
      whatWereYouDoing: body.what_were_you_doing,
      whatHappened: body.what_happened,
      urgency: body.urgency,
      errorCode: body.error_code || null,
      stackTrace: body.stack_trace || null,
      breadcrumbs: parseJsonField(body.breadcrumbs, []),
      deviceInfo: parseJsonField(body.device_info, null),
      screenshotBuffer: req.file?.buffer || null,
    });
    await logActivity({
      entityType: 'bug_report',
      entityId: report.id,
      action: 'bug.submitted',
      performedBy: req.user?.id,
      newValue: { ticket: report.ticket_number, urgency: report.urgency },
    });
    created(res, report);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 30 });
    const result = await bugReportService.listBugReports({
      limit,
      offset,
      status: req.query.status || null,
      urgency: req.query.urgency || null,
      search: req.query.search || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    ok(res, result.rows, {
      pagination: { page, limit, total: result.total },
      summary: await bugReportService.getSummary(),
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const row = await bugReportService.getBugReportById(req.params.id);
    if (!row) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    ok(res, row);
  } catch (err) {
    next(err);
  }
}

const updateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'wont_fix']).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  resolution_note: z.string().max(4000).optional(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const row = await bugReportService.updateBugReport(req.params.id, body);
    if (!row) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    await logActivity({
      entityType: 'bug_report',
      entityId: row.id,
      action: 'bug.updated',
      performedBy: req.user.id,
      newValue: body,
    });
    ok(res, row);
  } catch (err) {
    next(err);
  }
}

const commentSchema = z.object({
  comment: z.string().min(1).max(4000),
});

async function addComment(req, res, next) {
  try {
    const body = commentSchema.parse(req.body || {});
    const existing = await bugReportService.getBugReportById(req.params.id);
    if (!existing) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const row = await bugReportService.addComment(req.params.id, {
      comment: body.comment,
      commentedBy: req.user.id,
    });
    created(res, row);
  } catch (err) {
    next(err);
  }
}

module.exports = { submit, list, getOne, update, addComment };
