"""Guards for the deployment path.

These are cheap checks, but each one corresponds to a failure that only shows up
on a real host (where the database is PostgreSQL, not SQLite).
"""
from __future__ import annotations

from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent


def test_postgres_driver_ships_with_the_app():
    """The container installs from requirements.txt; psycopg must be in it."""
    requirements = (BACKEND / "requirements.txt").read_text(encoding="utf-8")
    active = [
        line.strip()
        for line in requirements.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    assert any(line.startswith("psycopg") for line in active), active


def test_alembic_uses_the_normalised_database_url():
    """A managed `postgres://` DSN must not fall back to the absent psycopg2."""
    env_source = (BACKEND / "alembic" / "env.py").read_text(encoding="utf-8")
    assert "_normalise_database_url(" in env_source
    # And the normaliser must be the one that maps provider DSNs to psycopg 3.
    from app.config import _normalise_database_url

    assert _normalise_database_url("postgres://u:p@h/d").startswith("postgresql+psycopg://")


def test_dockerfile_builds_the_spa_and_runs_migrations():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "npm run build" in dockerfile
    assert "alembic upgrade head" in dockerfile
    assert "uvicorn app.main:app" in dockerfile
    # Render/Fly inject $PORT; the container must honour it.
    assert "${PORT}" in dockerfile


def test_render_blueprint_points_at_the_dockerfile():
    blueprint = (ROOT / "render.yaml").read_text(encoding="utf-8")
    assert "dockerfilePath: ./Dockerfile" in blueprint
    assert "healthCheckPath: /healthz" in blueprint
    assert "fromDatabase:" in blueprint


def test_demo_seed_is_idempotent_and_logs_generated_credentials():
    """A Render wake restarts the service with SEED_DEMO=1 still set.

    Re-seeding must not duplicate the catalogue, and generated demo passwords
    must be readable in the log (they are otherwise unrecoverable).
    """
    from app import seed

    source = Path(seed.__file__).read_text(encoding="utf-8")
    assert "Catalogue already contains products" in source

    main_source = BACKEND.joinpath("app", "main.py").read_text(encoding="utf-8")
    assert "DEMO DATA CREATED" in main_source
