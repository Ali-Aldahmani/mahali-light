from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP


def money(n) -> float:
    """Match Express `Math.round((Number(n)||0)*100)/100` with half-up."""
    d = Decimal(str(n if n is not None else 0))
    q = (d * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return float(q / Decimal(100))


def percent_change(current, previous) -> float:
    try:
        previous_f = float(previous)
        current_f = float(current)
    except (TypeError, ValueError):
        return 0.0
    if abs(previous_f) < 0.0001:
        if abs(current_f) < 0.0001:
            return 0.0
        return 100.0
    return round(((current_f - previous_f) / abs(previous_f)) * 1000) / 10


def as_number(n, default=0):
    try:
        if n is None:
            return default
        return float(n)
    except (TypeError, ValueError):
        return default
