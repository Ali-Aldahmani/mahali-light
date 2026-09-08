"""Query parsing aligned with analyticsController Zod schemas (slice 01)."""

from __future__ import annotations

import re

from app.core.errors import AppError

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
# Express z.string().uuid() is RFC-like; also accept any 8-4-4-4-12 hex like our
# route helper historically did. FastAPI uses the same hex pattern Express Zod
# uses via z.string().uuid() (version nibble 1-5, variant 8/9/a/b).
# Contract tests use "not-a-uuid". Real variant IDs in this DB are UUID v4.


def optional_uuid(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    # Match Zod uuid(): reject obviously invalid; accept canonical hex UUID.
    hex_ok = re.match(
        r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        value,
    )
    if not hex_ok:
        raise AppError(
            "VALIDATION_FAILED",
            "Invalid uuid",
            details=[
                {
                    "code": "invalid_string",
                    "message": "Invalid uuid",
                    "path": ["query", field],
                }
            ],
        )
    return value


def optional_int(
    value: str | int | None,
    *,
    field: str,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int | None:
    if value is None or value == "":
        return None
    try:
        n = int(float(str(value)))
    except (TypeError, ValueError):
        raise AppError(
            "VALIDATION_FAILED",
            "Expected number, received nan",
            details=[{"code": "invalid_type", "message": "Expected number, received nan", "path": ["query", field]}],
        )
    if minimum is not None and n < minimum:
        msg = f"Number must be greater than or equal to {minimum}"
        raise AppError("VALIDATION_FAILED", msg, details=[{"code": "too_small", "message": msg, "path": ["query", field]}])
    if maximum is not None and n > maximum:
        msg = f"Number must be less than or equal to {maximum}"
        raise AppError("VALIDATION_FAILED", msg, details=[{"code": "too_big", "message": msg, "path": ["query", field]}])
    return n


def sparkline_metric(value: str | None) -> str:
    metric = value if value is not None and value != "" else "revenue"
    if metric not in ("revenue", "orders"):
        msg = "Invalid enum value. Expected 'revenue' | 'orders'"
        raise AppError(
            "VALIDATION_FAILED",
            msg,
            details=[{"code": "invalid_enum_value", "message": msg, "path": ["query", "metric"]}],
        )
    return metric
