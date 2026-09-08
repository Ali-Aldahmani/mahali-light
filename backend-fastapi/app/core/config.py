from functools import lru_cache
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"

    pghost: str = "localhost"
    pgport: int = 5432
    pguser: str = "postgres"
    pgpassword: str = "postgres"
    pgdatabase: str = "mahali_light"
    database_url: str | None = None

    fastapi_host: str = "0.0.0.0"
    fastapi_port: int = 8000
    log_level: str = "info"

    def sqlalchemy_url(self) -> str:
        if self.database_url:
            url = self.database_url
            if url.startswith("postgresql://") and "+psycopg" not in url:
                return url.replace("postgresql://", "postgresql+psycopg://", 1)
            return url
        user = quote_plus(self.pguser)
        password = quote_plus(self.pgpassword)
        return (
            f"postgresql+psycopg://{user}:{password}"
            f"@{self.pghost}:{self.pgport}/{self.pgdatabase}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
