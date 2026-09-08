from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_keys
from app.db.session import get_db
from app.modules.analytics import service as analytics_service
from app.shared.validation import optional_int, sparkline_metric

router = APIRouter()


def _ok(data: Any) -> dict:
    return {"success": True, "data": data}


@router.get("/kpis")
def kpis(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_dashboard"))],
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
):
    return _ok(analytics_service.get_kpis(db, {"start_date": start_date, "end_date": end_date}))


@router.get("/sparkline")
def sparkline(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_dashboard"))],
    metric: str | None = Query(default=None),
    days: str | None = Query(default=None),
):
    m = sparkline_metric(metric)
    d = optional_int(days, field="days", minimum=1, maximum=60)
    return _ok(analytics_service.get_sparkline(db, m, d or 7))


@router.get("/peak-hours")
def peak_hours(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_peaks"))],
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
):
    return _ok(
        analytics_service.get_peak_hours(db, {"start_date": start_date, "end_date": end_date})
    )


@router.get("/product-seasonality/{product_id}")
def product_seasonality(
    product_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_seasonality"))],
    years: str | None = Query(default=None),
):
    y = optional_int(years, field="years", minimum=1, maximum=5)
    return _ok(analytics_service.get_product_seasonality(db, product_id, y or 2))
