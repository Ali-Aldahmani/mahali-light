const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const analyticsService = require('../services/analyticsService');
const forecastService = require('../services/forecastService');
const { logActivity } = require('../utils/activityLog');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors?.[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const rangeSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// =======================================================================
// Analytics endpoints
// =======================================================================
async function netProfitTrends(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ group_by: z.enum(['day', 'week', 'month', 'year']).optional() })
      .parse(req.query);
    const data = await analyticsService.getNetProfitTrends({
      groupBy: parsed.group_by || 'month',
      startDate: parsed.start_date,
      endDate: parsed.end_date,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

const topSchema = rangeSchema.extend({
  limit: z.coerce.number().min(1).max(200).optional(),
  sort_by: z.enum(['revenue', 'profit', 'quantity', 'margin']).optional(),
});

async function topProducts(req, res, next) {
  try {
    const parsed = topSchema.parse(req.query);
    const data = await analyticsService.getTopProducts({
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      limit: parsed.limit,
      sortBy: parsed.sort_by,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function worstProducts(req, res, next) {
  try {
    const parsed = topSchema.parse(req.query);
    const data = await analyticsService.getWorstProducts({
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      limit: parsed.limit,
      sortBy: parsed.sort_by,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function topSuppliers(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ limit: z.coerce.number().min(1).max(100).optional() })
      .parse(req.query);
    const data = await analyticsService.getTopSuppliers({
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      limit: parsed.limit,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function worstSuppliers(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ limit: z.coerce.number().min(1).max(100).optional() })
      .parse(req.query);
    const data = await analyticsService.getWorstSuppliers(parsed);
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function topCustomers(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ limit: z.coerce.number().min(1).max(100).optional() })
      .parse(req.query);
    const data = await analyticsService.getTopCustomers({
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      limit: parsed.limit,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function atRiskCustomers(req, res, next) {
  try {
    const parsed = z
      .object({
        inactive_days: z.coerce.number().min(1).max(365).optional(),
        balance_threshold: z.coerce.number().min(0).optional(),
        limit: z.coerce.number().min(1).max(200).optional(),
      })
      .parse(req.query);
    const data = await analyticsService.getAtRiskCustomers({
      inactiveDays: parsed.inactive_days || 60,
      balanceThreshold: parsed.balance_threshold || 0,
      limit: parsed.limit || 50,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function employeePerformance(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ employee_id: z.string().uuid().optional() })
      .parse(req.query);

    // Permission scoping: cashier-style users only see themselves unless
    // they have the wider analytics permission.
    const owned = new Set(req.user?.permissions || []);
    let employeeId = parsed.employee_id || null;
    if (!owned.has('analytics.view')) {
      employeeId = req.user?.id;
    }
    const data = await analyticsService.getEmployeePerformance({
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      employeeId,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function peakHours(req, res, next) {
  try {
    const parsed = rangeSchema.parse(req.query);
    const data = await analyticsService.getPeakHours(parsed);
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function peakDays(req, res, next) {
  try {
    const parsed = rangeSchema.parse(req.query);
    const data = await analyticsService.getPeakDays(parsed);
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function peakHeatmap(req, res, next) {
  try {
    const parsed = rangeSchema.parse(req.query);
    const data = await analyticsService.getPeakHeatmap(parsed);
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function peakMonths(req, res, next) {
  try {
    const parsed = z
      .object({
        year: z.coerce.number().min(2000).max(2100).optional(),
        compare_year: z.coerce.number().min(2000).max(2100).optional(),
      })
      .parse(req.query);
    const data = await analyticsService.getPeakMonths({
      year: parsed.year,
      compareYear: parsed.compare_year,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function productSeasonality(req, res, next) {
  try {
    const parsed = z
      .object({ years: z.coerce.number().min(1).max(5).optional() })
      .parse(req.query);
    const data = await analyticsService.getProductSeasonality(req.params.id, {
      years: parsed.years || 2,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function kpis(req, res, next) {
  try {
    const parsed = rangeSchema.parse(req.query);
    const data = await analyticsService.getKPIs(parsed);
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function sparkline(req, res, next) {
  try {
    const parsed = z
      .object({
        metric: z.enum(['revenue', 'orders']).default('revenue'),
        days: z.coerce.number().min(1).max(60).optional(),
      })
      .parse(req.query);
    const data = await analyticsService.getSparkline(parsed.metric, {
      days: parsed.days || 7,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function dailySnapshot(_req, res, next) {
  try {
    ok(res, await analyticsService.getDailySnapshot());
  } catch (err) {
    next(err);
  }
}

async function salesTimeline(req, res, next) {
  try {
    const parsed = rangeSchema.parse(req.query);
    ok(res, await analyticsService.getSalesTimeline(parsed));
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function categoryBreakdown(req, res, next) {
  try {
    const parsed = rangeSchema
      .extend({ limit: z.coerce.number().min(1).max(20).optional() })
      .parse(req.query);
    ok(res, await analyticsService.getCategoryBreakdown(parsed));
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Forecasting endpoints
// =======================================================================
async function listReorder(req, res, next) {
  try {
    const parsed = z
      .object({
        low_stock_only: z.coerce.boolean().optional(),
        category_id: z.string().uuid().optional(),
      })
      .parse(req.query);
    const data = await forecastService.listReorderRecommendations({
      lowStockOnly: parsed.low_stock_only || false,
      categoryId: parsed.category_id || null,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function getReorder(req, res, next) {
  try {
    const data = await forecastService.getReorderForVariant(req.params.variantId);
    if (!data) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Variant not found.', { status: 404 });
    }
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function listAnnualPlan(req, res, next) {
  try {
    const parsed = z
      .object({
        year: z.coerce.number().min(2000).max(2100).optional(),
        category_id: z.string().uuid().optional(),
      })
      .parse(req.query);
    const data = await forecastService.listAnnualPlan({
      year: parsed.year,
      categoryId: parsed.category_id || null,
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function getAnnualPlan(req, res, next) {
  try {
    const parsed = z
      .object({ year: z.coerce.number().min(2000).max(2100).optional() })
      .parse(req.query);
    const data = await forecastService.getAnnualPlanForVariant(
      req.params.variantId,
      parsed.year,
    );
    if (!data) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Variant not found.', { status: 404 });
    }
    ok(res, data);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function recalculate(req, res, next) {
  try {
    const result = await forecastService.runAllForecasts({
      aggregate: true,
      actor: req.user,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

async function exportAnnualPlan(req, res, next) {
  try {
    const parsed = z
      .object({
        year: z.coerce.number().min(2000).max(2100).optional(),
        category_id: z.string().uuid().optional(),
      })
      .parse(req.query);
    const plans = await forecastService.listAnnualPlan({
      year: parsed.year,
      categoryId: parsed.category_id || null,
    });

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = req.user?.username || 'system';

    // Summary sheet: products as rows, months as columns (purchasing
    // budget planner).
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Product', key: 'product', width: 32 },
      { header: 'SKU', key: 'sku', width: 14 },
      ...Array.from({ length: 12 }, (_, i) => ({
        header: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
        key: `m${i + 1}`,
        width: 12,
      })),
      { header: 'Total Qty', key: 'qty', width: 12 },
      { header: 'Total Cost (AED)', key: 'cost', width: 16 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF0E6' },
    };

    for (const plan of plans) {
      const row = { product: plan.product_name, sku: plan.sku, qty: plan.total_qty, cost: plan.total_cost };
      for (const m of plan.months || []) row[`m${m.month}`] = Number(m.recommended_qty) || 0;
      summary.addRow(row);

      // Per-product detail sheet.
      const safeName = String(plan.product_name).slice(0, 28).replace(/[\\/?*[\]:]/g, '_');
      const ws = workbook.addWorksheet(safeName || `Plan ${plan.variant_id.slice(0, 6)}`);
      ws.columns = [
        { header: 'Month', key: 'month', width: 8 },
        { header: 'Recommended Qty', key: 'qty', width: 16 },
        { header: 'Estimated Cost (AED)', key: 'cost', width: 18 },
        { header: 'Basis', key: 'basis', width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const m of plan.months || []) {
        ws.addRow({
          month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.month - 1],
          qty: Number(m.recommended_qty),
          cost: Number(m.estimated_cost),
          basis: m.basis,
        });
      }
      ws.addRow({});
      ws.addRow({ month: 'Total', qty: plan.total_qty, cost: plan.total_cost }).font = { bold: true };
    }

    await logActivity({
      entityType: 'analytics',
      action: 'analytics.annual_plan_exported',
      performedBy: req.user?.id,
      newValue: { year: parsed.year, products: plans.length },
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="annual-stock-plan-${parsed.year || new Date().getFullYear()}.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function dismissReorder(req, res, next) {
  try {
    await logActivity({
      entityType: 'reorder_recommendation',
      entityId: req.params.id,
      action: 'analytics.reorder_dismissed',
      performedBy: req.user?.id,
    });
    ok(res, { dismissed: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  netProfitTrends,
  topProducts,
  worstProducts,
  topSuppliers,
  worstSuppliers,
  topCustomers,
  atRiskCustomers,
  employeePerformance,
  peakHours,
  peakDays,
  peakHeatmap,
  peakMonths,
  productSeasonality,
  kpis,
  sparkline,
  dailySnapshot,
  salesTimeline,
  categoryBreakdown,
  listReorder,
  getReorder,
  listAnnualPlan,
  getAnnualPlan,
  recalculate,
  exportAnnualPlan,
  dismissReorder,
};
