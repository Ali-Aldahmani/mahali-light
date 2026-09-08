"""Read-only forecast queries. SQL copied from server/services/forecastService.js."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.shared.dates import json_date
from app.shared.money import as_number, money


def list_reorder(db: Session, *, low_stock_only: bool = False, category_id: str | None = None):
    conds = ["v.is_active = true", "p.is_active = true"]
    params: dict = {}
    if category_id:
        params["category_id"] = category_id
        conds.append("p.category_id = :category_id")
    if low_stock_only:
        conds.append("v.stock_qty <= COALESCE(rr.reorder_point, 0)")
    where = " AND ".join(conds)
    rows = db.execute(
        text(
            f"""
            SELECT rr.*, v.stock_qty, p.name AS product_name, p.unit_label,
                   pc.name AS category_name,
                   v.sku
              FROM reorder_recommendations rr
              JOIN product_variants v ON v.id = rr.variant_id
              JOIN products p ON p.id = v.product_id
              LEFT JOIN product_categories pc ON pc.id = p.category_id
             WHERE {where}
             ORDER BY (v.stock_qty - rr.reorder_point) ASC, rr.calculated_at DESC
            """
        ),
        params,
    ).mappings().all()
    out = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "product_id": str(r["product_id"]),
                "variant_id": str(r["variant_id"]),
                "product_name": r["product_name"],
                "sku": r["sku"] or "",
                "category_name": r["category_name"] or None,
                "unit_label": r["unit_label"] or "pcs",
                "current_stock": as_number(r["stock_qty"]),
                "recommended_qty": as_number(r["recommended_qty"]),
                "reorder_point": as_number(r["reorder_point"]),
                "daily_avg_sales": as_number(r["daily_avg_sales"]),
                "lead_time_days": r["lead_time_days"],
                "safety_buffer_days": r["safety_buffer_days"],
                "peak_month": r["peak_month"],
                "is_peak_season": r["is_peak_season"],
                "peak_multiplier": as_number(r["peak_multiplier"]) or 2,
                "confidence": r["confidence"] or "low",
                "based_on_months": r["based_on_months"],
                "calculated_at": json_date(r["calculated_at"]),
            }
        )
    return out


def get_reorder(db: Session, variant_id: str):
    r = db.execute(
        text(
            """
            SELECT rr.*, v.stock_qty, p.name AS product_name, p.unit_label, v.sku
              FROM reorder_recommendations rr
              JOIN product_variants v ON v.id = rr.variant_id
              JOIN products p ON p.id = v.product_id
             WHERE rr.variant_id = :vid
            """
        ),
        {"vid": variant_id},
    ).mappings().first()
    if not r:
        # Read-only: missing cache row. Express GET no longer upserts.
        raise AppError("RESOURCE_NOT_FOUND", "Variant not found.", status=404)
    return {
        "variant_id": str(r["variant_id"]),
        "product_id": str(r["product_id"]),
        "product_name": r["product_name"],
        "current_stock": as_number(r["stock_qty"]),
        "recommended_qty": as_number(r["recommended_qty"]),
        "reorder_point": as_number(r["reorder_point"]),
        "daily_avg_sales": as_number(r["daily_avg_sales"]),
        "lead_time_days": r["lead_time_days"],
        "safety_buffer_days": r["safety_buffer_days"],
        "peak_month": r["peak_month"],
        "is_peak_season": r["is_peak_season"],
        "confidence": r["confidence"] or "low",
        "based_on_months": r["based_on_months"],
        "calculated_at": json_date(r["calculated_at"]),
    }


def list_annual_plan(db: Session, *, year: int | None = None, category_id: str | None = None):
    from datetime import datetime

    target_year = int(year) if year else datetime.now().year
    conds = ["plan.year = :year"]
    params: dict = {"year": target_year}
    if category_id:
        params["category_id"] = category_id
        conds.append("p.category_id = :category_id")
    where = " AND ".join(conds)
    rows = db.execute(
        text(
            f"""
            SELECT plan.product_id, plan.variant_id,
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
             WHERE {where}
             GROUP BY plan.product_id, plan.variant_id, p.name, v.sku, pc.name
             ORDER BY total_cost DESC
            """
        ),
        params,
    ).mappings().all()
    out = []
    for r in rows:
        months = r["months"] or []
        out.append(
            {
                "product_id": str(r["product_id"]),
                "variant_id": str(r["variant_id"]),
                "product_name": r["product_name"],
                "sku": r["sku"] or "",
                "category_name": r["category_name"] or None,
                "total_qty": round(as_number(r["total_qty"]) * 100) / 100,
                "total_cost": money(r["total_cost"]),
                "months": months,
            }
        )
    return out


def get_annual_plan(db: Session, variant_id: str, year: int | None = None):
    from datetime import datetime

    target_year = int(year) if year else datetime.now().year
    rows = db.execute(
        text(
            """
            SELECT * FROM annual_stock_plans
             WHERE variant_id = :vid AND year = :year
             ORDER BY month
            """
        ),
        {"vid": variant_id, "year": target_year},
    ).mappings().all()
    if not rows:
        raise AppError("RESOURCE_NOT_FOUND", "Variant not found.", status=404)
    vrows = db.execute(
        text(
            """
            SELECT v.id, p.name AS product_name, v.sku
              FROM product_variants v JOIN products p ON p.id = v.product_id
             WHERE v.id = :vid
            """
        ),
        {"vid": variant_id},
    ).mappings().first()
    plan = [
        {
            "month": r["month"],
            "recommended_qty": as_number(r["recommended_qty"]),
            "estimated_cost": as_number(r["estimated_cost"]),
            "basis": r["basis"],
        }
        for r in rows
    ]
    return {
        "variant_id": variant_id,
        "product_id": str(rows[0]["product_id"]),
        "product_name": (vrows["product_name"] if vrows else "") or "",
        "sku": (vrows["sku"] if vrows else "") or "",
        "year": target_year,
        "plan": plan,
        "totals": {
            "qty": money(sum(p["recommended_qty"] for p in plan)),
            "cost": money(sum(p["estimated_cost"] for p in plan)),
        },
    }
