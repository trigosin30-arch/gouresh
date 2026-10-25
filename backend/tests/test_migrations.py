"""The Alembic baseline must reproduce the SQLAlchemy schema exactly."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401  (registers tables on the metadata)
from app.db import Base

BACKEND = Path(__file__).resolve().parent.parent


def test_alembic_upgrade_head_builds_the_whole_schema(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(config, "head")

    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert "alembic_version" in tables

    # Running the same upgrade twice is a no-op, so deploys are repeatable.
    command.upgrade(config, "head")
    assert set(inspect(engine).get_table_names()) == tables
