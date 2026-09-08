"""Date-range helpers copied from server/services/analyticsService.js."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone


def parse_date_range(params: dict | None = None) -> dict[str, str]:
    params = params or {}
    now = datetime.now()
    y, m = now.year, now.month
    last = monthrange(y, m)[1]
    def_start = date(y, m, 1).isoformat()
    def_end = date(y, m, last).isoformat()
    raw_start = params.get("start_date") or params.get("startDate")
    raw_end = params.get("end_date") or params.get("endDate")
    if raw_start not in (None, ""):
        _assert_iso_date(str(raw_start)[:10], "start_date")
    if raw_end not in (None, ""):
        _assert_iso_date(str(raw_end)[:10], "end_date")
    start = str(raw_start or def_start)[:10]
    end = str(raw_end or def_end)[:10]
    return {"startDate": start, "endDate": end}


def _assert_iso_date(value: str, field: str) -> None:
    from app.core.errors import AppError

    if len(value) != 10:
        raise AppError("VALIDATION_FAILED", "Invalid date", field=field)
    try:
        y, m, d = (int(p) for p in value.split("-"))
        parsed = date(y, m, d)
    except ValueError as exc:
        raise AppError("VALIDATION_FAILED", "Invalid date", field=field) from exc
    if parsed.isoformat() != value:
        raise AppError("VALIDATION_FAILED", "Invalid date", field=field)


def previous_range(start_date: str, end_date: str) -> dict[str, str]:
    s = datetime.fromisoformat(f"{start_date}T00:00:00+00:00")
    e = datetime.fromisoformat(f"{end_date}T00:00:00+00:00")
    diff_days = max(1, round((e - s).total_seconds() / 86400) + 1)
    prev_end = s - timedelta(days=1)
    prev_start = prev_end - timedelta(days=diff_days - 1)
    return {
        "startDate": prev_start.date().isoformat(),
        "endDate": prev_end.date().isoformat(),
    }


def json_date(value) -> str | None:
    """Match JSON.stringify of a JS Date (toISOString, millisecond precision)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.astimezone()
        utc = dt.astimezone(timezone.utc)
        ms = utc.microsecond // 1000
        return utc.strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"
    if isinstance(value, date):
        # node-pg DATE → JS Date at local midnight, then toISOString()
        local_midnight = datetime(value.year, value.month, value.day).astimezone()
        return json_date(local_midnight)
    return str(value)


def coerce_bool(value) -> bool:
    """Zod z.coerce.boolean() uses Boolean(data); non-empty strings are true."""
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return bool(str(value))
