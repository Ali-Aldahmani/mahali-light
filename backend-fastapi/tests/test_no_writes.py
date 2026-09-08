def test_v2_has_no_write_methods():
    from app.main import app

    writes = []
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        path = getattr(route, "path", "")
        if methods & {"POST", "PUT", "PATCH", "DELETE"}:
            writes.append((sorted(methods), path))
    assert writes == []
