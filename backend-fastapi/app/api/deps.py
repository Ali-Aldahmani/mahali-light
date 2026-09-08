from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.security import authenticate_bearer, require_permission
from app.db.session import get_db


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
):
    user = authenticate_bearer(db, authorization)
    request.state.user_id = str(user.get("id") or "")
    return user


def require_keys(*keys: str):
    def _dep(user: Annotated[dict, Depends(get_current_user)]):
        require_permission(user, *keys)
        return user

    return _dep
