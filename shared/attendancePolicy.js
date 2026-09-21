const { AppError, ERROR_CODES } = require('./errorCodes');

const MANUAL_STATUSES = new Set(['present', 'late', 'absent', 'half_day', 'leave']);

/**
 * Derive attendance status from times. Client-provided status is advisory only
 * for leave/absent/half_day — anything else is computed server-side.
 */
function resolveManualAttendanceStatus({
  requestedStatus,
  checkIn,
  checkOut,
  lateMinutes = 0,
  standardHours = 8,
  workingHours = null,
}) {
  const req = requestedStatus && MANUAL_STATUSES.has(requestedStatus)
    ? requestedStatus
    : null;

  if (req === 'leave') return 'leave';
  if (req === 'absent' && !checkIn && !checkOut) return 'absent';

  if (!checkIn && !checkOut) {
    return 'absent';
  }

  if (checkIn && checkOut && workingHours != null) {
    const std = Number(standardHours) || 8;
    if (workingHours < std * 0.5) return 'half_day';
  }
  if (req === 'half_day') return 'half_day';

  if (checkIn && Number(lateMinutes) > 0) return 'late';
  return 'present';
}

function assertRequestedStatusAllowed(requestedStatus, resolvedStatus) {
  if (!requestedStatus || requestedStatus === resolvedStatus) return;
  const explicitOnly = new Set(['leave', 'absent', 'half_day']);
  if (explicitOnly.has(requestedStatus) && requestedStatus === resolvedStatus) return;
  if (explicitOnly.has(requestedStatus)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Status "${requestedStatus}" is not consistent with the supplied times.`,
      { status: 400, details: { requestedStatus, resolvedStatus } },
    );
  }
  throw new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    `Status must be derived from check-in/out times (expected "${resolvedStatus}").`,
    { status: 400, details: { requestedStatus, resolvedStatus } },
  );
}

module.exports = {
  resolveManualAttendanceStatus,
  assertRequestedStatusAllowed,
  MANUAL_STATUSES,
};
