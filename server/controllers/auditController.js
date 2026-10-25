const { z } = require('zod');
const { ok } = require('../utils/response');
const service = require('../services/auditService');

const querySchema = z.object({
  entityType: z.enum(Object.keys(service.RECORD_TYPES)), entityId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional(),
  scope: z.enum(['all', 'direct', 'related']).default('all'), action: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  search: z.string().trim().max(100).optional(),
});

async function list(req, res, next) {
  try {
    const result = await service.getRecordAudit({ ...req.query, user: req.user });
    return ok(res, result.events, { record: result.record, nextCursor: result.nextCursor });
  } catch (err) { return next(err); }
}
module.exports = { list, querySchema };
