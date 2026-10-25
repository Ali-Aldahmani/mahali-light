const express = require('express');
const { ok } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const presenceService = require('../services/presenceService');

const router = express.Router();

router.use(requireAuth());

// The snapshot behind the header's online list. Same rows and the same
// permission rule as the live `presence_update` events (presenceService),
// so a viewer that reconnects re-reads exactly what the events maintain.
router.get(
  '/',
  requireAnyPermission(...presenceService.PRESENCE_VIEW_PERMISSIONS),
  async (_req, res, next) => {
    try {
      return ok(res, await presenceService.listPresence());
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
