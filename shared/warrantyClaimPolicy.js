const { AppError, ERROR_CODES } = require('./errorCodes');

/** Status changes on PUT /warranty-claims/:id (terminal states use /resolve). */
const WARRANTY_CLAIM_STATUS_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: [],
  resolved: [],
  rejected: [],
};

function assertWarrantyClaimStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  const allowed = WARRANTY_CLAIM_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      ERROR_CODES.BIZ_INVALID_STATE,
      `Cannot change claim status from "${currentStatus}" to "${nextStatus}".`,
      { status: 409, details: { from: currentStatus, to: nextStatus } },
    );
  }
}

module.exports = {
  WARRANTY_CLAIM_STATUS_TRANSITIONS,
  assertWarrantyClaimStatusTransition,
};
