import json
import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("mahali.fastapi")


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        payload = {
            "request_id": req_id,
            "route": request.url.path,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": duration_ms,
            "user_id": getattr(request.state, "user_id", None),
            "error_code": getattr(request.state, "error_code", None),
        }
        logger.info(json.dumps(payload, default=str))
        response.headers["x-request-id"] = req_id
        return response
