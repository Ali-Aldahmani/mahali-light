"""Read-only analytics. SQL copied from server/services/analyticsService.js."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.shared.dates import json_date, parse_date_range, previous_range
from app.shared.money import as_number, money, percent_change


def get_kpis(db: Session, params: dict | None = None):
    rng = parse_date_range(params)
    if rng["startDate"] > rng["endDate"]:
        raise AppError("VAL_INVALID_DATE_RANGE")
    prev = previous_range(rng["startDate"], rng["endDate"])
    row = db.execute(
        text(
            """
            WITH inv AS (
              SELECT i.*,
                     COALESCE((SELECT SUM(ii.quantity * ii.cost_price_at_time)
                                 FROM invoice_items ii
                                WHERE ii.invoice_id = i.id), 0) AS cogs
                FROM invoices i
               WHERE i.status = 'confirmed'
            ),
            cur AS (
              SELECT COUNT(*)::int AS invoice_count,
                     COALESCE(SUM(taxable_amount), 0)::float8 AS revenue,
                     COALESCE(SUM(cogs), 0)::float8 AS cogs,
                     COALESCE(SUM(total), 0)::float8 AS gross,
                     COALESCE(AVG(total), 0)::float8 AS avg_order
                FROM inv
               WHERE confirmed_at::date BETWEEN CAST(:s1 AS DATE) AND CAST(:e1 AS DATE)
            ),
            prev_window AS (
              SELECT COUNT(*)::int AS invoice_count,
                     COALESCE(SUM(taxable_amount), 0)::float8 AS revenue,
                     COALESCE(SUM(cogs), 0)::float8 AS cogs,
                     COALESCE(SUM(total), 0)::float8 AS gross,
                     COALESCE(AVG(total), 0)::float8 AS avg_order
                FROM inv
               WHERE confirmed_at::date BETWEEN CAST(:s2 AS DATE) AND CAST(:e2 AS DATE)
            ),
            expenses_cur AS (
              SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM (
                SELECT amount_paid AS amount FROM bill_payments
                 WHERE paid_date IS NOT NULL AND paid_date BETWEEN CAST(:s1 AS DATE) AND CAST(:e1 AS DATE)
                UNION ALL
                SELECT amount FROM one_time_expenses
                 WHERE expense_date BETWEEN CAST(:s1 AS DATE) AND CAST(:e1 AS DATE)
              ) e
            ),
            receivables AS (
              SELECT COALESCE(SUM(credit_balance), 0)::float8 AS total FROM customers
               WHERE credit_balance > 0
            ),
            payables AS (
              SELECT COALESCE(SUM(balance_due), 0)::float8 AS total FROM purchase_orders
               WHERE balance_due > 0 AND status <> 'cancelled'
            ),
            ret AS (
              SELECT COALESCE(SUM(refund_total), 0)::float8 AS refunds,
                     COALESCE(SUM(total_value), 0)::float8 AS value
                FROM return_orders
               WHERE created_at::date BETWEEN CAST(:s1 AS DATE) AND CAST(:e1 AS DATE)
            ),
            inventory_value AS (
              SELECT COALESCE(SUM(stock_qty * cost_price), 0)::float8 AS total
                FROM product_variants
            )
            SELECT cur.*,
                   prev_window.revenue AS prev_revenue,
                   prev_window.cogs AS prev_cogs,
                   prev_window.gross AS prev_gross,
                   prev_window.avg_order AS prev_avg_order,
                   expenses_cur.total AS expenses,
                   receivables.total AS receivables_total,
                   payables.total AS payables_total,
                   ret.refunds AS refunds,
                   ret.value AS returned_value,
                   inventory_value.total AS inventory_value
              FROM cur, prev_window, expenses_cur, receivables, payables, ret, inventory_value
            """
        ),
        {
            "s1": rng["startDate"],
            "e1": rng["endDate"],
            "s2": prev["startDate"],
            "e2": prev["endDate"],
        },
    ).mappings().first()
    r = dict(row or {})
    revenue = as_number(r.get("revenue"))
    cogs = as_number(r.get("cogs"))
    gross_profit = revenue - cogs
    net_profit = gross_profit - as_number(r.get("expenses"))
    gross_margin = (gross_profit / revenue) * 100 if revenue > 0 else 0
    net_margin = (net_profit / revenue) * 100 if revenue > 0 else 0
    prev_revenue = as_number(r.get("prev_revenue"))
    inv_val = as_number(r.get("inventory_value"))
    turnover = as_number(r.get("cogs")) / inv_val if inv_val > 0 else 0
    total_invoiced = as_number(r.get("gross"))
    collection_rate = (
        ((total_invoiced - as_number(r.get("receivables_total"))) / total_invoiced) * 100
        if total_invoiced > 0
        else 0
    )
    return_rate = (
        (as_number(r.get("returned_value")) / total_invoiced) * 100 if total_invoiced > 0 else 0
    )
    expense_ratio = (as_number(r.get("expenses")) / revenue) * 100 if revenue > 0 else 0
    return {
        "period": {"startDate": rng["startDate"], "endDate": rng["endDate"]},
        "previous_period": prev,
        "revenue": money(revenue),
        "revenue_growth_pct": percent_change(revenue, prev_revenue),
        "gross_profit": money(gross_profit),
        "gross_margin_pct": round(gross_margin * 10) / 10,
        "net_profit": money(net_profit),
        "net_margin_pct": round(net_margin * 10) / 10,
        "expenses": money(as_number(r.get("expenses"))),
        "expense_ratio_pct": round(expense_ratio * 10) / 10,
        "inventory_value": money(inv_val),
        "inventory_turnover": round(turnover * 100) / 100,
        "avg_order_value": money(r.get("avg_order") or 0),
        "avg_order_growth_pct": percent_change(
            as_number(r.get("avg_order")), as_number(r.get("prev_avg_order"))
        ),
        "return_rate_pct": round(return_rate * 10) / 10,
        "collection_rate_pct": round(collection_rate * 10) / 10,
        "receivables_total": money(as_number(r.get("receivables_total"))),
        "payables_total": money(as_number(r.get("payables_total"))),
        "refunds": money(as_number(r.get("refunds"))),
        "invoice_count": int(r.get("invoice_count") or 0),
    }


def get_sparkline(db: Session, metric: str = "revenue", days: int = 7):
    safe = max(1, min(60, int(days or 7)))
    if metric == "revenue":
        rows = db.execute(
            text(
                """
                WITH days AS (
                  SELECT generate_series((CURRENT_DATE - CAST(:n AS int) + 1), CURRENT_DATE, '1 day'::interval)::date AS d
                )
                SELECT days.d AS bucket,
                       COALESCE(SUM(i.taxable_amount), 0)::float8 AS value
                  FROM days
                  LEFT JOIN invoices i ON i.status = 'confirmed' AND i.confirmed_at::date = days.d
                 GROUP BY days.d
                 ORDER BY days.d
                """
            ),
            {"n": safe},
        ).mappings().all()
        return [{"bucket": json_date(r["bucket"]), "value": money(r["value"])} for r in rows]
    if metric == "orders":
        rows = db.execute(
            text(
                """
                WITH days AS (
                  SELECT generate_series((CURRENT_DATE - CAST(:n AS int) + 1), CURRENT_DATE, '1 day'::interval)::date AS d
                )
                SELECT days.d AS bucket,
                       COUNT(i.id)::int AS value
                  FROM days
                  LEFT JOIN invoices i ON i.status = 'confirmed' AND i.confirmed_at::date = days.d
                 GROUP BY days.d
                 ORDER BY days.d
                """
            ),
            {"n": safe},
        ).mappings().all()
        return [{"bucket": json_date(r["bucket"]), "value": int(r["value"])} for r in rows]
    return []


def get_peak_hours(db: Session, params: dict | None = None):
    rng = parse_date_range(params)
    if rng["startDate"] > rng["endDate"]:
        raise AppError("VAL_INVALID_DATE_RANGE")
    rows = db.execute(
        text(
            """
            SELECT EXTRACT(HOUR FROM confirmed_at)::int AS hour,
                   COUNT(*)::int AS invoice_count,
                   COALESCE(SUM(total), 0)::float8 AS revenue
              FROM invoices
             WHERE status = 'confirmed'
               AND confirmed_at::date BETWEEN CAST(:s AS DATE) AND CAST(:e AS DATE)
             GROUP BY 1
             ORDER BY 1
            """
        ),
        {"s": rng["startDate"], "e": rng["endDate"]},
    ).mappings().all()
    by_hour = {int(r["hour"]): r for r in rows}
    series = []
    for h in range(24):
        r = by_hour.get(h)
        series.append(
            {
                "hour": h,
                "invoice_count": int(r["invoice_count"]) if r else 0,
                "revenue": money(r["revenue"]) if r else 0,
            }
        )
    sorted_s = sorted(series, key=lambda p: p["invoice_count"], reverse=True)
    peak = [p["hour"] for p in sorted_s[:3]]
    slow_src = [p for p in sorted_s if p["invoice_count"] > 0]
    slow = [p["hour"] for p in slow_src[-3:]]
    return {"series": series, "peak_hours": peak, "slow_hours": slow}


def get_product_seasonality(db: Session, product_id: str, years: int = 2):
    now = datetime.now()
    start_year = now.year - max(0, int(years) - 1)
    rows = db.execute(
        text(
            """
            SELECT year, month,
                   COALESCE(SUM(units_sold), 0)::float8 AS units,
                   COALESCE(SUM(revenue), 0)::float8 AS revenue
              FROM sales_history_monthly
             WHERE product_id = :pid AND year >= :sy
             GROUP BY year, month
             ORDER BY year, month
            """
        ),
        {"pid": product_id, "sy": start_year},
    ).mappings().all()
    lookup = {(int(r["year"]), int(r["month"])): r for r in rows}
    series = []
    for y in range(start_year, now.year + 1):
        for m in range(1, 13):
            # Express: `m > now.getMonth()` (0-indexed). Python month is 1-12.
            if y == now.year and m > now.month - 1:
                break
            r = lookup.get((y, m))
            series.append(
                {
                    "year": y,
                    "month": m,
                    "units": round(as_number(r["units"]) * 100) / 100 if r else 0,
                    "revenue": money(r["revenue"]) if r else 0,
                }
            )
    if not series:
        return {"series": [], "monthly_avg": [], "peak_months": [], "slow_months": []}
    total_units = sum(r["units"] for r in series)
    months_covered = len(series)
    annual_avg = total_units / months_covered
    month_buckets = [{"total": 0.0, "count": 0} for _ in range(12)]
    for r in series:
        month_buckets[r["month"] - 1]["total"] += r["units"]
        month_buckets[r["month"] - 1]["count"] += 1
    monthly_avg = []
    for idx, b in enumerate(month_buckets):
        avg = b["total"] / b["count"] if b["count"] > 0 else 0
        monthly_avg.append(
            {
                "month": idx + 1,
                "avg_units": round(avg * 100) / 100,
                "seasonality_index": round((avg / annual_avg) * 1000) / 10 if annual_avg > 0 else 0,
            }
        )
    peak_months = [m["month"] for m in monthly_avg if m["seasonality_index"] > 120]
    slow_months = [
        m["month"]
        for m in monthly_avg
        if m["seasonality_index"] < 80 and m["seasonality_index"] > 0
    ]
    return {
        "series": series,
        "monthly_avg": monthly_avg,
        "peak_months": peak_months,
        "slow_months": slow_months,
    }
