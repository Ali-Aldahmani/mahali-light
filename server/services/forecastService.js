const { query, withTransaction } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');

// =======================================================================
// Helpers
// =======================================================================
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function previousMonthBounds(date = new Date()) {
  // First and last day of the *previous* month relative to the supplied
  // date. We always aggregate the completed prior month — never the
  // current one (which would be a moving target).
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-based, so "previous" = m-1.
  const startDate = new Date(Date.UTC(y, m - 1, 1));
  const endDate = new Date(Date.UTC(y, m, 0));
  return {
    startIso: startDate.toISOString().slice(0, 10),
    endIso: endDate.toISOString().slice(0, 10),
    year: startDate.getUTCFullYear(),
    month: startDate.getUTCMonth() + 1,
  };
}

function confidenceFromHistory(months) {
  if (months >= 12) return 'high';
  if (months >= 6) return 'medium';
  return 'low';
}

// =======================================================================
// Aggregate the prior month's sales into sales_history_monthly. Idempotent
// — re-running will upsert the same numbers.
// =======================================================================
async function aggregateMonthlySales({ year, month } = {}) {
  let target;
  if (year && month) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    target = {
      startIso: start.toISOString().slice(0, 10),
      endIso: end.toISOString().slice(0, 10),
      year,
      month,
    };
  } else {
    target = previousMonthBounds(new Date());
  }

  // Aggregate sales for the chosen window.
  const { rows: salesRows } = await query(
    `SELECT ii.product_id, ii.variant_id,
            SUM(ii.quantity)::float8 AS units_sold,
            SUM(ii.line_total)::float8 AS revenue,
            SUM(ii.quantity * ii.cost_price_at_time)::float8 AS cost_total,
            SUM(ii.line_total - ii.quantity * ii.cost_price_at_time)::float8 AS gross_profit,
            COUNT(DISTINCT i.id)::int AS invoice_count,
            AVG(ii.unit_price)::float8 AS avg_selling_price,
            AVG(ii.cost_price_at_time)::float8 AS avg_cost_price
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY ii.product_id, ii.variant_id`,
    [target.startIso, target.endIso],
  );

  // Aggregate refunds/returns over the same window so the row carries the
  // *net* impact for reporting (gross sales minus returned).
  const { rows: returnRows } = await query(
    `SELECT roi.product_id, roi.variant_id,
            SUM(roi.quantity)::float8 AS qty
       FROM return_order_items roi
       JOIN return_orders ro ON ro.id = roi.return_order_id
      WHERE ro.created_at::date BETWEEN $1::date AND $2::date
      GROUP BY roi.product_id, roi.variant_id`,
    [target.startIso, target.endIso],
  );
  const returnsMap = new Map(
    returnRows.map((r) => [`${r.product_id}::${r.variant_id}`, Number(r.qty)]),
  );

  let upserts = 0;
  await withTransaction(async (client) => {
    // Wipe rows for the target month before writing — guarantees the
    // aggregation is exact (deletes/cancellations get reflected).
    await client.query(
      `DELETE FROM sales_history_monthly WHERE year = $1 AND month = $2`,
      [target.year, target.month],
    );
    for (const r of salesRows) {
      const key = `${r.product_id}::${r.variant_id}`;
      const returnQty = returnsMap.get(key) || 0;
      await client.query(
        `INSERT INTO sales_history_monthly
           (product_id, variant_id, year, month, units_sold, revenue, cost_total,
            gross_profit, return_qty, invoice_count, avg_selling_price, avg_cost_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (variant_id, year, month) DO UPDATE SET
           units_sold = EXCLUDED.units_sold,
           revenue = EXCLUDED.revenue,
           cost_total = EXCLUDED.cost_total,
           gross_profit = EXCLUDED.gross_profit,
           return_qty = EXCLUDED.return_qty,
           invoice_count = EXCLUDED.invoice_count,
           avg_selling_price = EXCLUDED.avg_selling_price,
           avg_cost_price = EXCLUDED.avg_cost_price`,
        [
          r.product_id,
          r.variant_id,
          target.year,
          target.month,
          money(r.units_sold),
          money(r.revenue),
          money(r.cost_total),
          money(r.gross_profit),
          money(returnQty),
          r.invoice_count,
          money(r.avg_selling_price),
          money(r.avg_cost_price),
        ],
      );
      upserts += 1;
    }
  });

  return { year: target.year, month: target.month, upserts };
}

// =======================================================================
// Reorder recommendation
// =======================================================================
async function calculateReorderRecommendation(variantId) {
  // Pull the variant + its supplier lead time.
  const { rows: vrows } = await query(
    `SELECT v.id AS variant_id, v.product_id, v.stock_qty, v.cost_price,
            p.name AS product_name,
            COALESCE(
              (SELECT AVG(EXTRACT(EPOCH FROM (po.received_date - po.order_date)) / 86400)
                 FROM purchase_order_items poi
                 JOIN purchase_orders po ON po.id = poi.purchase_order_id
                WHERE poi.variant_id = v.id
                  AND po.received_date IS NOT NULL
                  AND po.order_date IS NOT NULL),
              (SELECT MIN(s.default_lead_time_days)::float8
                 FROM purchase_order_items poi
                 JOIN purchase_orders po ON po.id = poi.purchase_order_id
                 JOIN suppliers s ON s.id = po.supplier_id
                WHERE poi.variant_id = v.id),
              7
            )::float8 AS lead_time_days
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  if (!vrows.length) return null;
  const v = vrows[0];
  const leadTimeDays = Math.max(1, Math.round(Number(v.lead_time_days) || 7));
  const safetyBufferDays = 7;

  // Last 12 months from sales_history_monthly.
  const { rows: hist } = await query(
    `SELECT year, month, units_sold
       FROM sales_history_monthly
      WHERE variant_id = $1
        AND (year, month) >= (
          EXTRACT(YEAR FROM (CURRENT_DATE - INTERVAL '11 months'))::int,
          EXTRACT(MONTH FROM (CURRENT_DATE - INTERVAL '11 months'))::int
        )
      ORDER BY year, month`,
    [variantId],
  );

  // No history? Calculate from raw invoices as a fallback so newly created
  // variants still get a starting recommendation.
  let monthsCovered = hist.length;
  let totalUnits = hist.reduce((s, r) => s + Number(r.units_sold), 0);
  if (monthsCovered === 0) {
    const { rows: live } = await query(
      `SELECT DATE_TRUNC('month', i.confirmed_at)::date AS bucket,
              COALESCE(SUM(ii.quantity), 0)::float8 AS units
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.variant_id = $1
          AND i.status = 'confirmed'
          AND i.confirmed_at >= NOW() - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY 1`,
      [variantId],
    );
    monthsCovered = live.length;
    totalUnits = live.reduce((s, r) => s + Number(r.units), 0);
  }

  const monthlyAvg = monthsCovered > 0 ? totalUnits / monthsCovered : 0;
  const dailyAvg = monthlyAvg / 30;
  const reorderPoint = dailyAvg * leadTimeDays;
  const safetyStock = dailyAvg * safetyBufferDays;
  let recommendedQty = reorderPoint + safetyStock;

  // Peak detection across calendar months.
  const monthlyBuckets = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  for (const r of hist) {
    const m = Number(r.month) - 1;
    monthlyBuckets[m].total += Number(r.units_sold);
    monthlyBuckets[m].count += 1;
  }
  const monthlyMeans = monthlyBuckets.map((b) => (b.count > 0 ? b.total / b.count : 0));
  const annualMean = monthlyMeans.reduce((s, v2) => s + v2, 0) / 12;
  let peakMonth = null;
  let peakMean = 0;
  for (let i = 0; i < 12; i += 1) {
    if (monthlyMeans[i] > peakMean) {
      peakMean = monthlyMeans[i];
      peakMonth = i + 1;
    }
  }
  const currentMonth = new Date().getMonth() + 1;
  const isPeakSeason =
    peakMonth != null && annualMean > 0 && peakMean > annualMean * 1.2 && currentMonth === peakMonth;
  const peakMultiplier = 2.0;
  if (isPeakSeason) recommendedQty *= peakMultiplier;

  const confidence = confidenceFromHistory(monthsCovered);

  await query(
    `INSERT INTO reorder_recommendations
       (product_id, variant_id, recommended_qty, based_on_months, daily_avg_sales,
        lead_time_days, safety_buffer_days, reorder_point, peak_month,
        is_peak_season, peak_multiplier, confidence, calculated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (variant_id) DO UPDATE SET
       recommended_qty = EXCLUDED.recommended_qty,
       based_on_months = EXCLUDED.based_on_months,
       daily_avg_sales = EXCLUDED.daily_avg_sales,
       lead_time_days = EXCLUDED.lead_time_days,
       safety_buffer_days = EXCLUDED.safety_buffer_days,
       reorder_point = EXCLUDED.reorder_point,
       peak_month = EXCLUDED.peak_month,
       is_peak_season = EXCLUDED.is_peak_season,
       peak_multiplier = EXCLUDED.peak_multiplier,
       confidence = EXCLUDED.confidence,
       calculated_at = NOW()`,
    [
      v.product_id,
      v.variant_id,
      money(Math.max(0, recommendedQty)),
      monthsCovered,
      Math.round(dailyAvg * 10000) / 10000,
      leadTimeDays,
      safetyBufferDays,
      money(reorderPoint),
      peakMonth,
      isPeakSeason,
      peakMultiplier,
      confidence,
    ],
  );

  return {
    variant_id: v.variant_id,
    product_id: v.product_id,
    product_name: v.product_name,
    current_stock: Number(v.stock_qty) || 0,
    daily_avg_sales: Math.round(dailyAvg * 10000) / 10000,
    lead_time_days: leadTimeDays,
    safety_buffer_days: safetyBufferDays,
    reorder_point: money(reorderPoint),
    recommended_qty: money(Math.max(0, recommendedQty)),
    peak_month: peakMonth,
    is_peak_season: isPeakSeason,
    confidence,
    based_on_months: monthsCovered,
  };
}

// =======================================================================
// Annual stock plan
// =======================================================================
async function calculateAnnualStockPlan(variantId, year) {
  const targetYear = Number(year) || new Date().getFullYear();

  const { rows: vrows } = await query(
    `SELECT v.id, v.product_id, v.cost_price, p.name AS product_name
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  if (!vrows.length) return null;
  const v = vrows[0];

  const { rows: hist } = await query(
    `SELECT year, month, units_sold
       FROM sales_history_monthly
      WHERE variant_id = $1
      ORDER BY year, month`,
    [variantId],
  );

  // Per-month historical average. We average across the year-month pairs
  // present so the plan reflects seasonality automatically.
  const monthlyBuckets = Array.from({ length: 12 }, () => []);
  for (const r of hist) {
    monthlyBuckets[Number(r.month) - 1].push(Number(r.units_sold));
  }
  const monthlyAvg = monthlyBuckets.map((arr) =>
    arr.length ? arr.reduce((s, v2) => s + v2, 0) / arr.length : 0,
  );
  const annualMean = monthlyAvg.reduce((s, v2) => s + v2, 0) / 12 || 0;

  // Year-over-year growth: only compute when we have at least 12 months of
  // history (so it reflects a full year-to-year cycle).
  let growthRate = 0;
  if (hist.length >= 24) {
    const recent = hist.slice(-12).reduce((s, r) => s + Number(r.units_sold), 0);
    const older = hist.slice(-24, -12).reduce((s, r) => s + Number(r.units_sold), 0);
    if (older > 0) growthRate = (recent / older - 1);
  }

  const plan = [];
  await withTransaction(async (client) => {
    // Wipe the year first so re-runs leave a clean plan rather than
    // accumulating stale months.
    await client.query(
      `DELETE FROM annual_stock_plans WHERE variant_id = $1 AND year = $2`,
      [variantId, targetYear],
    );
    for (let m = 1; m <= 12; m += 1) {
      const histAvg = monthlyAvg[m - 1];
      const projected = histAvg * (1 + growthRate);
      const seasonalityIndex = annualMean > 0 ? histAvg / annualMean : 1;
      const peak = annualMean > 0 && histAvg > annualMean * 1.2;
      const cost = projected * Number(v.cost_price || 0);
      const recommendedQty = money(Math.max(0, projected));
      const estimatedCost = money(Math.max(0, cost));
      const basis = hist.length > 0 ? 'historical' : 'manual';
      await client.query(
        `INSERT INTO annual_stock_plans
           (product_id, variant_id, year, month, recommended_qty, estimated_cost, basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (variant_id, year, month) DO UPDATE SET
           recommended_qty = EXCLUDED.recommended_qty,
           estimated_cost = EXCLUDED.estimated_cost,
           basis = EXCLUDED.basis`,
        [v.product_id, variantId, targetYear, m, recommendedQty, estimatedCost, basis],
      );
      plan.push({
        month: m,
        historical_avg: Math.round(histAvg * 100) / 100,
        seasonality_index: Math.round(seasonalityIndex * 100) / 100,
        is_peak: peak,
        recommended_qty: recommendedQty,
        estimated_cost: estimatedCost,
      });
    }
  });

  return {
    variant_id: variantId,
    product_id: v.product_id,
    product_name: v.product_name,
    year: targetYear,
    growth_rate_pct: Math.round(growthRate * 1000) / 10,
    annual_avg_units: Math.round(annualMean * 100) / 100,
    months_of_history: hist.length,
    confidence: confidenceFromHistory(hist.length),
    plan,
    totals: {
      qty: money(plan.reduce((s, p) => s + p.recommended_qty, 0)),
      cost: money(plan.reduce((s, p) => s + p.estimated_cost, 0)),
    },
  };
}

// =======================================================================
// List APIs (used by the analytics UI)
// =======================================================================
async function listReorderRecommendations({
  lowStockOnly = false,
  categoryId = null,
} = {}) {
  const conds = ['v.is_active = true', 'p.is_active = true'];
  const vals = [];
  if (categoryId) {
    vals.push(categoryId);
    conds.push(`p.category_id = $${vals.length}`);
  }
  if (lowStockOnly) {
    conds.push('v.stock_qty <= COALESCE(rr.reorder_point, 0)');
  }
  const { rows } = await query(
    `SELECT rr.*, v.stock_qty, p.name AS product_name, p.unit_label,
            pc.name AS category_name,
            v.sku
       FROM reorder_recommendations rr
       JOIN product_variants v ON v.id = rr.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE ${conds.join(' AND ')}
      ORDER BY (v.stock_qty - rr.reorder_point) ASC, rr.calculated_at DESC`,
    vals,
  );
  return rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    variant_id: r.variant_id,
    product_name: r.product_name,
    sku: r.sku || '',
    category_name: r.category_name || null,
    unit_label: r.unit_label || 'pcs',
    current_stock: Number(r.stock_qty) || 0,
    recommended_qty: Number(r.recommended_qty) || 0,
    reorder_point: Number(r.reorder_point) || 0,
    daily_avg_sales: Number(r.daily_avg_sales) || 0,
    lead_time_days: r.lead_time_days,
    safety_buffer_days: r.safety_buffer_days,
    peak_month: r.peak_month,
    is_peak_season: r.is_peak_season,
    peak_multiplier: Number(r.peak_multiplier) || 2,
    confidence: r.confidence || 'low',
    based_on_months: r.based_on_months,
    calculated_at: r.calculated_at,
  }));
}

async function getReorderForVariant(variantId) {
  const { rows } = await query(
    `SELECT rr.*, v.stock_qty, p.name AS product_name, p.unit_label, v.sku
       FROM reorder_recommendations rr
       JOIN product_variants v ON v.id = rr.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE rr.variant_id = $1`,
    [variantId],
  );
  if (!rows.length) {
    // Fall back to a fresh calc when no row exists yet.
    return calculateReorderRecommendation(variantId);
  }
  const r = rows[0];
  return {
    variant_id: r.variant_id,
    product_id: r.product_id,
    product_name: r.product_name,
    current_stock: Number(r.stock_qty) || 0,
    recommended_qty: Number(r.recommended_qty),
    reorder_point: Number(r.reorder_point),
    daily_avg_sales: Number(r.daily_avg_sales),
    lead_time_days: r.lead_time_days,
    safety_buffer_days: r.safety_buffer_days,
    peak_month: r.peak_month,
    is_peak_season: r.is_peak_season,
    confidence: r.confidence || 'low',
    based_on_months: r.based_on_months,
    calculated_at: r.calculated_at,
  };
}

async function listAnnualPlan({ year, categoryId = null } = {}) {
  const targetYear = Number(year) || new Date().getFullYear();
  const conds = ['plan.year = $1'];
  const vals = [targetYear];
  if (categoryId) {
    vals.push(categoryId);
    conds.push(`p.category_id = $${vals.length}`);
  }
  const { rows } = await query(
    `SELECT plan.product_id, plan.variant_id,
            p.name AS product_name, v.sku, pc.name AS category_name,
            JSON_AGG(JSON_BUILD_OBJECT(
              'month', plan.month,
              'recommended_qty', plan.recommended_qty,
              'estimated_cost', plan.estimated_cost,
              'basis', plan.basis
            ) ORDER BY plan.month) AS months,
            SUM(plan.recommended_qty)::float8 AS total_qty,
            SUM(plan.estimated_cost)::float8 AS total_cost
       FROM annual_stock_plans plan
       JOIN product_variants v ON v.id = plan.variant_id
       JOIN products p ON p.id = plan.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE ${conds.join(' AND ')}
      GROUP BY plan.product_id, plan.variant_id, p.name, v.sku, pc.name
      ORDER BY total_cost DESC`,
    vals,
  );
  return rows.map((r) => ({
    product_id: r.product_id,
    variant_id: r.variant_id,
    product_name: r.product_name,
    sku: r.sku || '',
    category_name: r.category_name || null,
    total_qty: Math.round(Number(r.total_qty) * 100) / 100,
    total_cost: money(r.total_cost),
    months: r.months || [],
  }));
}

async function getAnnualPlanForVariant(variantId, year) {
  const targetYear = Number(year) || new Date().getFullYear();
  const { rows } = await query(
    `SELECT * FROM annual_stock_plans WHERE variant_id = $1 AND year = $2 ORDER BY month`,
    [variantId, targetYear],
  );
  if (!rows.length) {
    // Generate on demand the first time someone opens this view.
    return calculateAnnualStockPlan(variantId, targetYear);
  }
  const { rows: vrows } = await query(
    `SELECT v.id, p.name AS product_name, v.sku
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  return {
    variant_id: variantId,
    product_id: rows[0].product_id,
    product_name: vrows[0]?.product_name || '',
    sku: vrows[0]?.sku || '',
    year: targetYear,
    plan: rows.map((r) => ({
      month: r.month,
      recommended_qty: Number(r.recommended_qty),
      estimated_cost: Number(r.estimated_cost),
      basis: r.basis,
    })),
    totals: {
      qty: money(rows.reduce((s, r) => s + Number(r.recommended_qty), 0)),
      cost: money(rows.reduce((s, r) => s + Number(r.estimated_cost), 0)),
    },
  };
}

// =======================================================================
// Full forecast run (cron + manual)
// =======================================================================
async function runAllForecasts({ aggregate = true, actor = null } = {}) {
  let aggregated = null;
  if (aggregate) aggregated = await aggregateMonthlySales();
  const year = new Date().getFullYear();
  const { rows: variants } = await query(
    `SELECT v.id FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.is_active = true AND p.is_active = true`,
  );
  let reorderCount = 0;
  let planCount = 0;
  let failures = 0;
  for (const { id } of variants) {
    try {
      await calculateReorderRecommendation(id);
      reorderCount += 1;
    } catch (err) {
      console.warn('[forecast] reorder failed for', id, err.message);
      failures += 1;
    }
    try {
      await calculateAnnualStockPlan(id, year);
      planCount += 1;
    } catch (err) {
      console.warn('[forecast] annual plan failed for', id, err.message);
      failures += 1;
    }
  }
  await logActivity({
    entityType: 'analytics',
    action: 'analytics.forecast_recalculated',
    performedBy: actor?.id || null,
    newValue: {
      aggregated,
      reorder_count: reorderCount,
      plan_count: planCount,
      failures,
    },
  });
  return {
    aggregated,
    reorder_count: reorderCount,
    plan_count: planCount,
    failures,
    variants_total: variants.length,
  };
}

// =======================================================================
// Cron scheduler: aggregate monthly sales + recalc all forecasts at 02:00
// on the 1st of every month.
// =======================================================================
let timer = null;

// setTimeout delays above this (~24.8 days) are silently clamped to 1ms by
// Node, which would fire the "monthly" run almost immediately instead of
// waiting. Chain shorter waits until the real target is within range.
const MAX_TIMEOUT_MS = 2147483647;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  // First of next month, local time, 02:00.
  next.setMonth(now.getMonth() + 1, 1);
  next.setHours(2, 0, 0, 0);
  // If we're early in the day on the 1st and 02:00 hasn't passed, run today.
  if (now.getDate() === 1 && now.getHours() < 2) {
    next.setMonth(now.getMonth(), 1);
    next.setHours(2, 0, 0, 0);
  }
  return next - now;
}

function scheduleNextRun() {
  const delay = msUntilNextRun();
  if (timer) clearTimeout(timer);
  if (delay > MAX_TIMEOUT_MS) {
    timer = setTimeout(scheduleNextRun, MAX_TIMEOUT_MS);
    return;
  }
  timer = setTimeout(async () => {
    try {
      const result = await runAllForecasts({ aggregate: true });
      console.log('[forecast] monthly run complete', result);
    } catch (err) {
      console.warn('[forecast] monthly run failed', err.message);
    }
    scheduleNextRun();
  }, delay);
  const next = new Date(Date.now() + delay);
  console.log(`[forecast] next monthly run scheduled for ${next.toISOString()}`);
}

function startForecastJob() {
  scheduleNextRun();
}

module.exports = {
  aggregateMonthlySales,
  calculateReorderRecommendation,
  calculateAnnualStockPlan,
  runAllForecasts,
  listReorderRecommendations,
  getReorderForVariant,
  listAnnualPlan,
  getAnnualPlanForVariant,
  startForecastJob,
};
