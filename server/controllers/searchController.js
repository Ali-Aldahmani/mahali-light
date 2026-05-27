const { ok } = require('../utils/response');
const searchService = require('../services/searchService');

async function global(req, res, next) {
  try {
    const q = (req.query.q || '').toString().trim();
    const perms = req.user?.permissions || [];
    const results = await searchService.globalSearch(q, {
      userId: req.user.id,
      permissions: perms,
    });
    ok(res, results);
  } catch (err) {
    next(err);
  }
}

module.exports = { global };
