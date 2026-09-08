import logging

from fastapi import FastAPI
from sqlalchemy import text

from app.db.session import get_engine

logging.basicConfig(level=logging.INFO, format="%(message)s")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Bytecra POS ML service",
        version="0.1.0",
        description="Optional future ML/AI sidecar. Express remains the POS backend.",
    )

    @app.get("/health")
    def health():
        db_ok = False
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False
        return {
            "success": True,
            "data": {
                "status": "ok" if db_ok else "degraded",
                "service": "mahali-ml-future",
                "database": "up" if db_ok else "down",
                "role": "future_ml_only",
            },
        }

    return app


app = create_app()
