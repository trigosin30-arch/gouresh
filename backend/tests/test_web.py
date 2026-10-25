"""Public web surface: SPA hosting, legacy redirects, headers, health, SEO files."""
from __future__ import annotations

import pytest

from app.config import settings
from app.services import settings as store_settings


@pytest.fixture()
def dist(tmp_path, monkeypatch):
    """A stand-in for the compiled Vite build."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('spa')", encoding="utf-8")
    (tmp_path / "index.html").write_text("<!doctype html><title>Ankit</title>", encoding="utf-8")
    monkeypatch.setattr(settings, "frontend_dist", str(tmp_path))
    return tmp_path


def test_spa_routes_serve_the_app_shell(client, dist):
    for path in ("/", "/products", "/product/sample-notebook", "/cart", "/admin", "/admin/orders"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "Ankit" in response.text, path


def test_unknown_path_returns_404_but_renders_the_app(client, dist):
    response = client.get("/this-page-does-not-exist")
    assert response.status_code == 404
    # The shell is returned so the client can show a friendly NotFound page.
    assert "Ankit" in response.text


def test_static_assets_are_served(client, dist):
    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert "spa" in response.text


def test_unknown_api_path_is_json_404(client, dist):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_legacy_html_urls_redirect_permanently(client, dist):
    response = client.get("/index.html", follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"] == "/"

    response = client.get("/products.html", follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"] == "/products"


def test_unknown_legacy_page_redirects_to_not_found(client, dist):
    response = client.get("/ancient-page.html", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/404"


def test_security_headers_are_present(client, dist):
    response = client.get("/")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert "frame-ancestors" not in response.headers["content-security-policy"]
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_api_responses_are_not_cached(client):
    response = client.get("/api/store/bootstrap")
    assert response.headers["cache-control"] == "no-store"


def test_health_endpoint_reports_database_state(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


def test_sitemap_and_robots_are_served(client, db):
    store_settings.set_many(db, {"store_phone": "0181 000 0000", "delivery_enabled": False})
    sitemap = client.get("/sitemap.xml")
    assert sitemap.status_code == 200
    assert "xml" in sitemap.headers["content-type"]
    assert "<urlset" in sitemap.text
    robots = client.get("/robots.txt")
    assert robots.status_code == 200
    assert "Sitemap:" in robots.text


def test_missing_build_returns_a_helpful_message(client, monkeypatch):
    monkeypatch.setattr(settings, "frontend_dist", "/tmp/definitely-not-built")
    response = client.get("/")
    assert response.status_code == 200
    assert "Frontend build not found" in response.text
    assert client.get("/products").status_code == 404


@pytest.mark.parametrize(
    "given,expected",
    [
        ("postgres://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("sqlite:////tmp/x.db", "sqlite:////tmp/x.db"),
    ],
)
def test_database_urls_from_hosting_providers_are_normalised(given, expected):
    """Render/Heroku hand out postgres:// DSNs; they must map to the bundled driver."""
    from app.config import _normalise_database_url

    assert _normalise_database_url(given) == expected
