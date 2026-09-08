"""Alembic env — baseline only. Autogenerate against the live POS schema is forbidden."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None  # Existing tables are owned by Express migrations.


def run_migrations_offline() -> None:
    raise RuntimeError(
        "Alembic is a future FastAPI-owned baseline only. "
        "Do not autogenerate or apply diffs against the existing PostgreSQL schema. "
        "See docs/fastapi-migration/ALEMBIC_BASELINE.md"
    )


def run_migrations_online() -> None:
    if context.get_x_argument(as_dictionary=True).get("allow_fastapi_owned") != "1":
        raise RuntimeError(
            "Refusing to run Alembic against the shared POS database. "
            "Express server/db/migrations remains authoritative. "
            "Pass -x allow_fastapi_owned=1 only for future FastAPI-owned empty revisions."
        )
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
