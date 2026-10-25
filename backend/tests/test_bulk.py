"""Bulk quotations: request → quote → accept → order (criterion 13)."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select

from app.models import BulkQuotation, Order, Product
from tests.conftest import csrf, login, make_product, make_user


def quotation_payload(product_id: str | None = None):
    return {
        "organization_name": "Sunrise Public School",
        "organization_type": "School",
        "contact_name": "Principal Sharma",
        "contact_email": "office@school.example.com",
        "contact_phone": "9876543210",
        "delivery_location": "School campus, Jalandhar Cantt",
        "target_date": (date.today() + timedelta(days=20)).isoformat(),
        "notes": "Please include notebooks and geometry boxes.",
        "items": [
            {"product_id": product_id, "description": "Ruled notebooks (200 pages)", "quantity": 200},
            {"product_id": None, "description": "Geometry box", "quantity": 120},
        ],
    }


def test_bulk_quotation_full_workflow(client, db, shop):
    product = make_product(db, title="Bulk Notebook", stock=500, price_paise=12000)
    created = client.post("/api/quotations", json=quotation_payload(product.id), headers=csrf(client))
    assert created.status_code == 201, created.text
    body = created.json()
    reference = body["quotation"]["reference"]
    token = body["access_token"]
    assert body["quotation"]["status"] == "submitted"
    assert "not a confirmed order" in body["message"].lower()
    assert body["quotation"]["quote_total_paise"] is None

    # Customer cannot accept before a quote exists
    assert client.post(f"/api/quotations/{reference}/accept?token={token}", headers=csrf(client)).status_code == 409

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    rows = client.get("/api/admin/quotations").json()["quotations"]
    quotation = rows[0]
    item_ids = [item["id"] for item in quotation["items"]]
    quote = client.post(
        f"/api/admin/quotations/{quotation['id']}/quote",
        json={
            "items": [
                {"item_id": item_ids[0], "unit_price_paise": 10000},
                {"item_id": item_ids[1], "unit_price_paise": 22000},
            ],
            "quote_notes": "Prices valid for 15 days.",
            "quote_valid_until": (date.today() + timedelta(days=15)).isoformat(),
        },
        headers=csrf(client),
    )
    assert quote.status_code == 200, quote.text
    assert quote.json()["quote_total_paise"] == 200 * 10000 + 120 * 22000

    # Admin cannot convert an unaccepted quote
    assert client.post(f"/api/admin/quotations/{quotation['id']}/convert", headers=csrf(client)).status_code == 409
    client.post("/api/auth/logout", headers=csrf(client))

    # Customer accepts using the emailed/printed access token (no login needed)
    document = client.get(f"/api/quotations/{reference}/document?token={token}")
    assert document.status_code == 200
    assert "Bulk quotation" in document.text
    accepted = client.post(f"/api/quotations/{reference}/accept?token={token}", headers=csrf(client))
    assert accepted.status_code == 200
    assert accepted.json()["quotation"]["status"] == "accepted"
    assert client.get(f"/api/quotations/{reference}?token=wrong").status_code == 404

    login(client, "admin@example.com")
    converted = client.post(f"/api/admin/quotations/{quotation['id']}/convert", headers=csrf(client))
    assert converted.status_code == 200, converted.text
    order = converted.json()["order"]
    assert order["order_type"] == "bulk"
    assert order["total_paise"] == 200 * 10000 + 120 * 22000

    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 300  # 200 committed
    quotation_row = db.scalar(select(BulkQuotation))
    assert quotation_row.status == "converted"
    assert quotation_row.order_id == order["id"]
    assert db.scalar(select(Order).where(Order.order_type == "bulk")) is not None

    # Conversion is one-way
    assert client.post(f"/api/admin/quotations/{quotation['id']}/convert", headers=csrf(client)).status_code == 409


def test_quote_conversion_fails_when_stock_is_insufficient(client, db, shop):
    product = make_product(db, title="Scarce Item", stock=5, price_paise=10000)
    payload = quotation_payload(product.id)
    payload["items"] = [{"product_id": product.id, "description": "Scarce item", "quantity": 10}]
    created = client.post("/api/quotations", json=payload, headers=csrf(client)).json()
    token = created["access_token"]
    reference = created["quotation"]["reference"]

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    quotation = client.get("/api/admin/quotations").json()["quotations"][0]
    item_id = quotation["items"][0]["id"]
    client.post(
        f"/api/admin/quotations/{quotation['id']}/quote",
        json={"items": [{"item_id": item_id, "unit_price_paise": 9000}]},
        headers=csrf(client),
    )
    client.post("/api/auth/logout", headers=csrf(client))
    client.post(f"/api/quotations/{reference}/accept?token={token}", headers=csrf(client))
    login(client, "admin@example.com")
    response = client.post(f"/api/admin/quotations/{quotation['id']}/convert", headers=csrf(client))
    assert response.status_code == 409
    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 5


def test_expired_quotation_cannot_be_accepted(client, db, shop):
    product = make_product(db, stock=50)
    created = client.post("/api/quotations", json=quotation_payload(product.id), headers=csrf(client)).json()
    reference = created["quotation"]["reference"]
    token = created["access_token"]

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    quotation = client.get("/api/admin/quotations").json()["quotations"][0]
    client.post(
        f"/api/admin/quotations/{quotation['id']}/quote",
        json={
            "items": [{"item_id": i["id"], "unit_price_paise": 1000} for i in quotation["items"]],
            "quote_valid_until": (date.today() + timedelta(days=1)).isoformat(),
        },
        headers=csrf(client),
    )
    client.post("/api/auth/logout", headers=csrf(client))

    row = db.scalar(select(BulkQuotation))
    row.quote_valid_until = date.today() - timedelta(days=1)
    db.commit()

    response = client.post(f"/api/quotations/{reference}/accept?token={token}", headers=csrf(client))
    assert response.status_code == 409
    db.expire_all()
    assert db.scalar(select(BulkQuotation)).status == "expired"


def test_quotation_validation(client, db):
    payload = quotation_payload()
    payload["items"] = []
    assert client.post("/api/quotations", json=payload, headers=csrf(client)).status_code == 422
    payload = quotation_payload()
    payload["contact_phone"] = "123"
    assert client.post("/api/quotations", json=payload, headers=csrf(client)).status_code == 422
    payload = quotation_payload()
    payload["target_date"] = (date.today() - timedelta(days=2)).isoformat()
    assert client.post("/api/quotations", json=payload, headers=csrf(client)).status_code == 400


def test_quotation_access_control(client, db, shop):
    product = make_product(db, stock=10)
    created = client.post("/api/quotations", json=quotation_payload(product.id), headers=csrf(client)).json()
    reference = created["quotation"]["reference"]
    # No token + no session: not visible
    assert client.get(f"/api/quotations/{reference}").status_code == 404
    # Reference + email lookup works (customer convenience) and returns a token
    found = client.get(f"/api/quotations?reference={reference}&email=office@school.example.com")
    assert found.status_code == 200
    assert found.json()["access_token"]
