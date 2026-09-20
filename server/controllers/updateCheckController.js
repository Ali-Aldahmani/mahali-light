'use strict';

const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const updateCheckService = require('../services/updateCheckService');

function requireAdmin(req) {
  if (req.user.role !== 'Admin') {
    throw new AppError(
      ERROR_CODES.AUTH_NO_PERMISSION,
      'Only administrators can manage app updates.',
      { status: 403, details: { permission: 'admin' } },
    );
  }
}

async function check(req, res, next) {
  try {
    requireAdmin(req);
    const result = await updateCheckService.checkForUpdates();
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

async function getStatus(req, res, next) {
  try {
    requireAdmin(req);
    return ok(res, updateCheckService.getInstallStatus());
  } catch (err) {
    next(err);
  }
}

async function install(req, res, next) {
  try {
    requireAdmin(req);

    // Never trust the client's version: only the latest version discovered by
    // the check endpoint may be installed.
    const target = await updateCheckService.resolveInstallTarget();
    const bodyVersion = String((req.body || {}).version || '').replace(/^v/, '');
    if (bodyVersion && bodyVersion !== target.latestVersion) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Cannot install v${bodyVersion}; a different update (v${target.latestVersion}) is available.`,
        { status: 409 },
      );
    }

    const status = updateCheckService.startInstall(target.latestVersion);
    if (!status) {
      throw new AppError(
        ERROR_CODES.SYS_UPDATE_IN_PROGRESS,
        'An update is already being installed. Please wait.',
        { status: 409 },
      );
    }

    return res.status(202).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

module.exports = { check, getStatus, install };