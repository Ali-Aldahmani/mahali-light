const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { todayStoreDate, storeDate } = require('../utils/dates');
const lostSales = require('../services/lostSalesService');

// Data kept for later demand forecasting and purchase advice (data
// readiness 2026-11-12): lost sales, promotions, the store calendar and
// opening hours. History is kept: promotions are ended, not deleted; opening
// hours are dated versions; calendar corrections are logged.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30.');
const uuid = z.string().uuid();
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };
const range = (req) => ({
  startDate: req.query.start_date || `${todayStoreDate().slice(0, 8)}01`,
  endDate: req.query.end_date || todayStoreDate(),
});

// ------------------------------------------------------------- lost sales
const lostSaleSchema = z.object({
  variantId: uuid,
  quantity: z.number().positive().max(100000).optional(),
  source: z.enum(['till_out_of_stock', 'manual']).default('manual'),
  note: z.string().max(300).optional().nullable(),
});

// ------------------------------------------------------------- promotions
const promotionSchema = z.object({
  name: z.string().trim().min(2).max(150),
  startsOn: day,
  endsOn: day,
  discountPercent: z.number().positive().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(z.object({
    productId: uuid.optional(), variantId: uuid.optional(), categoryId: uuid.optional(),
  }).refine((i) => [i.productId, i.variantId, i.categoryId].filter(Boolean).length === 1,
    'Each item is one product, one variant or one category.')).min(1).max(500),
}).refine((p) => p.endsOn >= p.startsOn, { message: 'A promotion can’t end before it starts.', path: ['endsOn'] });

function shapePromotion(r) {
  return {
    id: r.id, name: r.name, startsOn: storeDate(r.starts_on), endsOn: storeDate(r.ends_on),
    discountPercent: r.discount_percent == null ? null : Number(r.discount_percent), notes: r.notes,
    endedEarlyAt: r.ended_early_at, createdAt: r.created_at, createdBy: r.created_by_name || null,
    items: r.items || [],
  };
}

async function loadPromotions(where = 'TRUE', params = []) {
  const { rows } = await query(
    `SELECT pr.*, u.username AS created_by_name,
            COALESCE(json_agg(json_build_object(
              'productId', pi.product_id, 'variantId', pi.variant_id, 'categoryId', pi.category_id,
              'label', COALESCE(v.sku || ' · ' || vp.name, p.name, c.name)))
              FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
       FROM promotions pr
       LEFT JOIN users u ON u.id = pr.created_by
       LEFT JOIN promotion_items pi ON pi.promotion_id = pr.id
       LEFT JOIN products p ON p.id = pi.product_id
       LEFT JOIN product_variants v ON v.id = pi.variant_id
       LEFT JOIN products vp ON vp.id = v.product_id
       LEFT JOIN product_categories c ON c.id = pi.category_id
      WHERE ${where}
      GROUP BY pr.id, u.username
      ORDER BY pr.starts_on DESC, pr.created_at DESC`, params);
  return rows.map(shapePromotion);
}

// ------------------------------------------------------------- calendar
const eventSchema = z.object({
  kind: z.enum(['closed', 'ramadan', 'eid', 'public_holiday', 'special']),
  name: z.string().trim().min(2).max(150),
  startsOn: day,
  endsOn: day,
  estimated: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
}).refine((e) => e.endsOn >= e.startsOn, { message: 'The last day can’t be before the first.', path: ['endsOn'] });

const shapeEvent = (r) => ({
  id: r.id, kind: r.kind, name: r.name, startsOn: storeDate(r.starts_on), endsOn: storeDate(r.ends_on),
  estimated: r.estimated, notes: r.notes, updatedAt: r.updated_at,
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');
const hoursSchema = z.object({
  effectiveFrom: day.optional(),
  // ISO weekday 1 (Monday) to 7 (Sunday); null = closed that day.
  hours: z.record(z.enum(['1', '2', '3', '4', '5', '6', '7']),
    z.object({ open: time, close: time }).nullable()),
});

module.exports = {
  // Lost sales
  recordLostSale: wrap(async (req, res) => {
    const body = lostSaleSchema.parse(req.body || {});
    const { rows: [v] } = await query(`SELECT stock_qty::float8 AS q FROM product_variants WHERE id = $1`, [body.variantId]);
    const row = await lostSales.record({
      variantId: body.variantId, quantity: body.quantity ?? 1, availableQty: v ? v.q : null,
      source: body.source, userId: req.user.id, note: body.note || null,
    });
    created(res, { id: row.id, occurrences: row.occurrences });
  }),
  listLostSales: wrap(async (req, res) => ok(res, await lostSales.list({ ...range(req), variantId: req.query.variant_id || null }))),

  // Promotions
  listPromotions: wrap(async (req, res) => ok(res, await loadPromotions())),
  createPromotion: wrap(async (req, res) => {
    const body = promotionSchema.parse(req.body || {});
    const id = await withTransaction(async (client) => {
      const { rows: [pr] } = await client.query(
        `INSERT INTO promotions (name, starts_on, ends_on, discount_percent, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [body.name, body.startsOn, body.endsOn, body.discountPercent ?? null, body.notes || null, req.user.id]);
      for (const it of body.items) {
        await client.query(
          `INSERT INTO promotion_items (promotion_id, product_id, variant_id, category_id) VALUES ($1,$2,$3,$4)`,
          [pr.id, it.productId || null, it.variantId || null, it.categoryId || null]);
      }
      await logActivity({ client, entityType: 'promotion', entityId: pr.id, action: 'promotion.created',
        performedBy: req.user.id, newValue: body, notes: body.name });
      return pr.id;
    });
    created(res, (await loadPromotions('pr.id = $1', [id]))[0]);
  }),
  // Ends a promotion today (kept, not deleted, so the sales it drove stay explained).
  endPromotion: wrap(async (req, res) => {
    const today = todayStoreDate();
    const { rows } = await query(
      `UPDATE promotions SET ends_on = GREATEST(starts_on, $2::date), ended_early_at = NOW()
        WHERE id = $1 AND ends_on > $2::date RETURNING id`, [req.params.id, today]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'This promotion has already ended.', { status: 409 });
    }
    await logActivity({ entityType: 'promotion', entityId: req.params.id, action: 'promotion.ended', performedBy: req.user.id });
    ok(res, (await loadPromotions('pr.id = $1', [req.params.id]))[0]);
  }),

  // Store calendar
  listEvents: wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM store_calendar_events
        WHERE ($1::date IS NULL OR ends_on >= $1::date) AND ($2::date IS NULL OR starts_on <= $2::date)
        ORDER BY starts_on`, [req.query.start_date || null, req.query.end_date || null]);
    ok(res, rows.map(shapeEvent));
  }),
  createEvent: wrap(async (req, res) => {
    const b = eventSchema.parse(req.body || {});
    const { rows: [r] } = await query(
      `INSERT INTO store_calendar_events (kind, name, starts_on, ends_on, estimated, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.kind, b.name, b.startsOn, b.endsOn, Boolean(b.estimated), b.notes || null, req.user.id]);
    await logActivity({ entityType: 'store_calendar', entityId: r.id, action: 'store_calendar.created', performedBy: req.user.id, newValue: b });
    created(res, shapeEvent(r));
  }),
  // Correct an event (e.g. Eid dates once announced). The old dates are kept in the activity log.
  updateEvent: wrap(async (req, res) => {
    const b = eventSchema.parse(req.body || {});
    const { rows: [old] } = await query(`SELECT * FROM store_calendar_events WHERE id = $1`, [req.params.id]);
    if (!old) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    const { rows: [r] } = await query(
      `UPDATE store_calendar_events SET kind = $2, name = $3, starts_on = $4, ends_on = $5, estimated = $6, notes = $7, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id, b.kind, b.name, b.startsOn, b.endsOn, Boolean(b.estimated), b.notes || null]);
    await logActivity({ entityType: 'store_calendar', entityId: r.id, action: 'store_calendar.updated', performedBy: req.user.id,
      oldValue: shapeEvent(old), newValue: b });
    ok(res, shapeEvent(r));
  }),

  // Opening hours: dated versions; the latest started on or before a day applies to it.
  getHours: wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT h.*, u.username AS created_by_name FROM store_opening_hours h LEFT JOIN users u ON u.id = h.created_by
        ORDER BY effective_from DESC, created_at DESC LIMIT 20`);
    const today = todayStoreDate();
    const current = rows.find((r) => storeDate(r.effective_from) <= today) || null;
    const shape = (r) => ({ id: r.id, effectiveFrom: storeDate(r.effective_from), hours: r.hours, createdAt: r.created_at, createdBy: r.created_by_name });
    ok(res, { current: current && shape(current), versions: rows.map(shape) });
  }),
  setHours: wrap(async (req, res) => {
    const b = hoursSchema.parse(req.body || {});
    for (const [d, h] of Object.entries(b.hours)) {
      if (h && h.close <= h.open) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Day ${d}: closing time must be after opening time.`, { status: 400 });
      }
    }
    const { rows: [r] } = await query(
      `INSERT INTO store_opening_hours (effective_from, hours, created_by) VALUES ($1, $2::jsonb, $3) RETURNING id`,
      [b.effectiveFrom || todayStoreDate(), JSON.stringify(b.hours), req.user.id]);
    await logActivity({ entityType: 'store_hours', entityId: r.id, action: 'store_hours.set', performedBy: req.user.id, newValue: b });
    created(res, { id: r.id });
  }),
};
