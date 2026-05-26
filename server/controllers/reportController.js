const fs = require('fs');
const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const reportService = require('../services/reportService');
const reportExporter = require('../services/reportExporter');
const scheduledReportService = require('../services/scheduledReportService');
const { logActivity } = require('../utils/activityLog');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors?.[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

// =======================================================================
// Report dispatcher
// =======================================================================
function paramsFromQuery(req) {
  const q = { ...req.query };
  // Strip Express path/format helpers so the report service only sees actual
  // filters. `:type` lives on req.params.
  delete q.format;
  return q;
}

// Cashier reading employee_performance for someone else? Re-scope to their
// own user id. Permission separation keeps the SQL simple.
function maybeScopeEmployee(req, type, params) {
  if (type !== 'employee_performance') return params;
  const ownPerm = 'report.employee_performance_own';
  const allPerm = 'report.employee_performance_all';
  const owned = new Set(req.user?.permissions || []);
  if (!owned.has(allPerm)) {
    if (owned.has(ownPerm)) {
      return { ...params, employee_id: req.user?.id };
    }
    throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
      status: 403,
      details: { missing: [ownPerm] },
    });
  }
  return params;
}

function checkPermission(req, type) {
  const required = reportService.requiredPermission(type);
  const owned = new Set(req.user?.permissions || []);
  // Special-case employee_performance: either own or all unlocks the route.
  if (type === 'employee_performance') {
    if (
      !owned.has('report.employee_performance_own') &&
      !owned.has('report.employee_performance_all')
    ) {
      throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
        status: 403,
        details: { missing: ['report.employee_performance_own'] },
      });
    }
    return;
  }
  if (!owned.has(required)) {
    throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
      status: 403,
      details: { missing: [required] },
    });
  }
}

async function runReport(req, res, next) {
  try {
    const type = req.params.type;
    if (!reportService.isValidType(type)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Unknown report "${type}".`, { status: 400 });
    }
    checkPermission(req, type);
    const params = maybeScopeEmployee(req, type, paramsFromQuery(req));
    const result = await reportService.generateReport(type, params);
    await logActivity({
      entityType: 'report',
      action: 'report.generated',
      performedBy: req.user?.id || null,
      newValue: { type, params },
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function exportReport(req, res, next) {
  try {
    const type = req.params.type;
    if (!reportService.isValidType(type)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Unknown report "${type}".`, { status: 400 });
    }
    checkPermission(req, type);
    const format = String(req.query.format || 'pdf').toLowerCase();
    const permKey =
      format === 'pdf' ? 'report.export_pdf'
        : format === 'csv' ? 'report.export_csv'
          : format === 'excel' || format === 'xlsx' ? 'report.export_excel'
            : null;
    if (!permKey) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Unsupported format "${format}".`, { status: 400 });
    }
    const owned = new Set(req.user?.permissions || []);
    if (!owned.has(permKey)) {
      throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
        status: 403,
        details: { missing: [permKey] },
      });
    }

    const params = maybeScopeEmployee(req, type, paramsFromQuery(req));
    const data = await reportService.generateReport(type, params);

    if (format === 'csv') {
      const body = await reportExporter.exportToCSV(data);
      const filename = `${type}-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await logActivity({
        entityType: 'report',
        action: 'report.exported',
        performedBy: req.user?.id || null,
        newValue: { type, format },
      });
      return res.send(body);
    }

    const fn =
      format === 'excel' || format === 'xlsx'
        ? reportExporter.exportToExcel
        : reportExporter.exportToPDF;
    const file = await fn(data, { user: req.user });
    await logActivity({
      entityType: 'report',
      action: 'report.exported',
      performedBy: req.user?.id || null,
      newValue: { type, format, file: file.filename },
    });

    const mime =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return fs.createReadStream(file.absPath).pipe(res);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// =======================================================================
// Scheduled reports CRUD
// =======================================================================
const scheduleSchema = z.object({
  report_type: z.string().min(2),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  send_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  day_of_week: z.number().int().min(1).max(7).optional().nullable(),
  day_of_month: z.number().int().min(1).max(28).optional().nullable(),
  recipients: z
    .array(
      z.object({
        employee_id: z.string().optional().nullable(),
        name: z.string().optional(),
        email: z.string().email(),
      }),
    )
    .min(1),
  format: z.enum(['pdf', 'csv', 'excel']).default('pdf'),
  filters: z.record(z.any()).optional().nullable(),
  is_active: z.boolean().optional(),
});

async function listSchedules(req, res, next) {
  try {
    const list = await scheduledReportService.listSchedules();
    return ok(res, list);
  } catch (err) {
    next(err);
  }
}

async function createSchedule(req, res, next) {
  try {
    const body = scheduleSchema.parse(req.body || {});
    if (!reportService.isValidType(body.report_type)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Unknown report "${body.report_type}".`, {
        status: 400,
      });
    }
    const created = await scheduledReportService.createSchedule({
      ...body,
      createdBy: req.user?.id || null,
    });
    await logActivity({
      entityType: 'scheduled_report',
      entityId: created.id,
      action: 'scheduled_report.created',
      performedBy: req.user?.id || null,
      newValue: { type: created.report_type, frequency: created.frequency },
    });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function updateSchedule(req, res, next) {
  try {
    const id = req.params.id;
    const body = scheduleSchema.partial().parse(req.body || {});
    const updated = await scheduledReportService.updateSchedule(id, body);
    return ok(res, updated);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function deleteSchedule(req, res, next) {
  try {
    const id = req.params.id;
    await scheduledReportService.deleteSchedule(id);
    return ok(res, { id, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function runScheduleNow(req, res, next) {
  try {
    const id = req.params.id;
    const result = await scheduledReportService.runScheduleNow(id, req.user);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Static registry listing — frontend hub uses this to enumerate types.
// =======================================================================
function listRegistry(_req, res) {
  const entries = Object.entries(reportService.REGISTRY).map(([type, def]) => ({
    type,
    permission: def.permission,
  }));
  return ok(res, entries);
}

module.exports = {
  runReport,
  exportReport,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  listRegistry,
};
