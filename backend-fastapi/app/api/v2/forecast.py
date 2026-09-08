from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_keys
from app.db.session import get_db
from app.modules.forecast import service as forecast_service
from app.shared.dates import coerce_bool
from app.shared.validation import optional_int, optional_uuid

router = APIRouter()


def _ok(data: Any) -> dict:
    return {"success": True, "data": data}


@router.get("/reorder")
def list_reorder(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_reorder"))],
    low_stock_only: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
):
    cid = optional_uuid(category_id, "category_id")
    data = forecast_service.list_reorder(
        db,
        low_stock_only=coerce_bool(low_stock_only),
        category_id=cid,
    )
    return _ok(data)


@router.get("/reorder/{variant_id}")
def get_reorder(
    variant_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_reorder"))],
):
    return _ok(forecast_service.get_reorder(db, variant_id))


@router.get("/annual-plan")
def list_annual_plan(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_reorder"))],
    year: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
):
    cid = optional_uuid(category_id, "category_id")
    y = optional_int(year, field="year", minimum=2000, maximum=2100)
    return _ok(forecast_service.list_annual_plan(db, year=y, category_id=cid))


@router.get("/annual-plan/{variant_id}")
def get_annual_plan(
    variant_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[dict, Depends(require_keys("analytics.view_reorder"))],
    year: str | None = Query(default=None),
):
    y = optional_int(year, field="year", minimum=2000, maximum=2100)
    return _ok(forecast_service.get_annual_plan(db, variant_id, y))
