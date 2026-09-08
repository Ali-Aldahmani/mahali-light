from fastapi import APIRouter

from app.api.v2 import analytics, forecast

api_v2 = APIRouter()
api_v2.include_router(forecast.router, prefix="/forecast", tags=["forecast"])
api_v2.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
