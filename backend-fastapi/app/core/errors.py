"""Express-compatible error envelope for this slice only."""

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

ERROR_MESSAGES = {
    "AUTH_TOKEN_MISSING": "Authentication token missing.",
    "AUTH_TOKEN_INVALID": "Invalid authentication token.",
    "AUTH_SESSION_EXPIRED": "Your session has expired. Please log in again.",
    "AUTH_ACCOUNT_INACTIVE": "This account has been deactivated.",
    "AUTH_NO_PERMISSION": "You don't have permission to perform this action.",
    "VALIDATION_FAILED": "The submitted data is invalid.",
    "RESOURCE_NOT_FOUND": "The requested resource was not found.",
    "VAL_INVALID_DATE_RANGE": "End date must be after start date.",
    "INTERNAL_ERROR": "Something went wrong on the server.",
}

STATUS_FOR = {
    "AUTH_TOKEN_MISSING": 401,
    "AUTH_TOKEN_INVALID": 401,
    "AUTH_SESSION_EXPIRED": 401,
    "AUTH_ACCOUNT_INACTIVE": 403,
    "AUTH_NO_PERMISSION": 403,
    "VALIDATION_FAILED": 400,
    "RESOURCE_NOT_FOUND": 404,
    "VAL_INVALID_DATE_RANGE": 400,
    "INTERNAL_ERROR": 500,
}


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        status: int | None = None,
        details: Any = None,
        field: str | None = None,
    ):
        self.code = code
        self.message = message or ERROR_MESSAGES.get(code, "Error")
        self.status = status or STATUS_FOR.get(code, 500)
        self.details = details
        self.field = field
        super().__init__(self.message)


def error_body(code: str, message: str, details: Any = None, field: str | None = None) -> dict:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details if details is not None else None,
            "field": field,
        },
    }


async def app_error_handler(request: Request, err: AppError) -> JSONResponse:
    request.state.error_code = err.code
    return JSONResponse(
        status_code=err.status,
        content=error_body(err.code, err.message, err.details, err.field),
    )


async def validation_handler(_request: Request, err: RequestValidationError) -> JSONResponse:
    raw = err.errors()
    first = raw[0] if raw else {}
    msg = first.get("msg") or "Invalid request."
    details = [
        {
            "code": e.get("type"),
            "message": e.get("msg"),
            "path": list(e.get("loc") or []),
        }
        for e in raw
    ]
    return JSONResponse(
        status_code=400,
        content=error_body("VALIDATION_FAILED", msg, details, None),
    )


async def http_exception_handler(_request: Request, err: StarletteHTTPException) -> JSONResponse:
    if isinstance(err.detail, dict) and "error" in err.detail:
        return JSONResponse(status_code=err.status_code, content=err.detail)
    return JSONResponse(
        status_code=err.status_code,
        content=error_body("INTERNAL_ERROR", str(err.detail), None, None),
    )


async def unhandled_handler(_request: Request, err: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=error_body("INTERNAL_ERROR", ERROR_MESSAGES["INTERNAL_ERROR"], None, None),
    )
