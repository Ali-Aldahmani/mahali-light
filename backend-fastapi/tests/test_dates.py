from app.shared.dates import parse_date_range, previous_range, coerce_bool


def test_coerce_bool_matches_js_boolean():
    assert coerce_bool(None) is False
    assert coerce_bool("false") is True
    assert coerce_bool("") is False
    assert coerce_bool("true") is True


def test_previous_range_length():
    prev = previous_range("2024-01-01", "2024-01-31")
    assert prev["endDate"] == "2023-12-31"
    assert prev["startDate"] == "2023-12-01"


def test_explicit_range_passthrough():
    r = parse_date_range({"start_date": "2024-06-01", "end_date": "2024-06-15"})
    assert r == {"startDate": "2024-06-01", "endDate": "2024-06-15"}


def test_invalid_date_raises():
    from app.core.errors import AppError

    try:
        parse_date_range({"start_date": "not-a-date"})
        raise AssertionError("expected AppError")
    except AppError as err:
        assert err.code == "VALIDATION_FAILED"
        assert err.field == "start_date"
