"""JWT + SHA-256 session lookup matching Express server/middleware/auth.js."""

from __future__ import annotations

import hashlib
from typing import Any

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def decode_jwt(token: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.jwt_secret:
        raise AppError("INTERNAL_ERROR", "JWT_SECRET is not configured")
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except ExpiredSignatureError as exc:
        raise AppError("AUTH_SESSION_EXPIRED") from exc
    except InvalidTokenError as exc:
        raise AppError("AUTH_TOKEN_INVALID") from exc


def load_user_context(db: Session, user_id: str) -> dict[str, Any] | None:
    user_row = db.execute(
        text(
            """
            SELECT u.id, u.username, u.is_active, u.employee_id,
                   r.id AS role_id, r.name AS role_name
              FROM users u
              LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.id = :id
            """
        ),
        {"id": user_id},
    ).mappings().first()
    if not user_row:
        return None
    user = dict(user_row)
    user["role"] = user.get("role_name")

    perm_rows = db.execute(
        text(
            """
            SELECT p.key FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = :role_id
            """
        ),
        {"role_id": user.get("role_id")},
    ).mappings().all()
    role_keys = {r["key"] for r in perm_rows}

    override_rows = db.execute(
        text(
            """
            SELECT p.key, up.granted
              FROM user_permissions up
              JOIN permissions p ON p.id = up.permission_id
             WHERE up.user_id = :uid
            """
        ),
        {"uid": user_id},
    ).mappings().all()
    effective = set(role_keys)
    for row in override_rows:
        if row["granted"]:
            effective.add(row["key"])
        else:
            effective.discard(row["key"])
    user["permissions"] = list(effective)
    return user


def authenticate_bearer(db: Session, authorization: str | None) -> dict[str, Any]:
    header = authorization or ""
    if not header.startswith("Bearer "):
        raise AppError("AUTH_TOKEN_MISSING")
    token = header[len("Bearer ") :].strip()
    payload = decode_jwt(token)
    sub = payload.get("sub")
    if not sub:
        raise AppError("AUTH_TOKEN_INVALID")

    sess = db.execute(
        text(
            """
            SELECT id, logout_at, status FROM user_sessions
             WHERE token_hash = :h
             ORDER BY login_at DESC
             LIMIT 1
            """
        ),
        {"h": hash_token(token)},
    ).mappings().first()
    if not sess or sess["logout_at"]:
        raise AppError("AUTH_SESSION_EXPIRED")

    user = load_user_context(db, str(sub))
    if not user:
        raise AppError("AUTH_TOKEN_INVALID")
    if not user.get("is_active"):
        raise AppError("AUTH_ACCOUNT_INACTIVE")

    user["session_id"] = str(sess["id"])
    try:
        db.execute(
            text("UPDATE user_sessions SET last_activity_at = NOW() WHERE id = :id"),
            {"id": sess["id"]},
        )
        db.commit()
    except Exception:
        db.rollback()
    return user


def require_permission(user: dict[str, Any], *keys: str) -> None:
    owned = set(user.get("permissions") or [])
    missing = [k for k in keys if k not in owned]
    if missing:
        raise AppError(
            "AUTH_NO_PERMISSION",
            status=403,
            details={"missing": missing},
        )
