function ok(res, data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.json(payload);
}

function created(res, data) {
  return res.status(201).json({ success: true, data });
}

function parsePagination(req, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { ok, created, parsePagination };
