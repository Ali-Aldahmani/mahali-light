def test_v2_has_no_write_methods():
    from app.main import app

    writes = []
    for route in app.routes:
        methods = getattr(route, "methods", None) or set()
        path = getattr(route, "path", "")
        if methods & {"POST", "PUT", "PATCH", "DELETE"}:
            writes.append((sorted(methods), path))
    assert writes == []


def test_authenticate_bearer_never_writes():
    """Route-method inspection above only proves no route is *declared*
    POST/PUT/PATCH/DELETE - it wouldn't catch a write hidden inside a GET
    request's own dependency chain, which is exactly what used to happen
    here (a last_activity_at UPDATE + commit on every authenticated
    request, removed as part of MED-04 in CODEBASE_AUDIT.md).

    Two independent checks, so a regression is caught even if only one
    signal would fire: (1) no SQL passed to db.execute() contains a write
    keyword: caught this exact bug directly the first time this test was
    written, since the mock only had 4 queued responses for the 4
    legitimate reads and the 5th call (the UPDATE) raising inside the old
    code's own broad `except Exception: db.rollback()` was silently
    swallowed, which made a naive "was commit() called" check pass for
    the wrong reason against the still-buggy code. (2) db.commit() is
    never called - the session (app/db/session.py get_db) is never
    auto-committed, so even a write that did execute would be discarded
    when the request-scoped session closes without a commit.
    """
    import os
    import re
    from unittest.mock import MagicMock

    import jwt

    from app.core.config import get_settings
    from app.core.security import authenticate_bearer

    os.environ.setdefault("JWT_SECRET", "test-secret-abcdefghijklmnopqrstuvwxyz-32")
    get_settings.cache_clear()
    settings = get_settings()
    token = jwt.encode({"sub": "user-1"}, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    def row(mapping):
        m = MagicMock()
        m.mappings.return_value.first.return_value = mapping
        m.mappings.return_value.all.return_value = []
        return m

    queued = [
        row({"id": "sess-1", "logout_at": None, "status": "online"}),  # user_sessions lookup
        row(
            {
                "id": "user-1",
                "username": "t",
                "is_active": True,
                "employee_id": None,
                "role_id": "role-1",
                "role_name": "Admin",
            }
        ),  # users lookup (load_user_context)
        row(None),  # role_permissions (.all())
        row(None),  # user_permissions (.all())
    ]

    def execute_side_effect(*_args, **_kwargs):
        # Any call beyond the 4 legitimate reads above (e.g. a
        # reintroduced write) gets a generic success response rather than
        # StopIteration, so it reaches db.commit() instead of being
        # swallowed by a broad except - that's what makes the assertions
        # below a real regression check rather than a tautology.
        return queued.pop(0) if queued else row(None)

    db = MagicMock()
    db.execute.side_effect = execute_side_effect

    user = authenticate_bearer(db, f"Bearer {token}")

    assert user["id"] == "user-1"

    write_re = re.compile(r"\b(UPDATE|INSERT|DELETE)\b", re.IGNORECASE)
    for call in db.execute.call_args_list:
        sql = str(call.args[0]) if call.args else ""
        assert not write_re.search(sql), f"authenticate_bearer issued a write: {sql!r}"
    assert db.commit.called is False, "authenticate_bearer must never commit a write"
