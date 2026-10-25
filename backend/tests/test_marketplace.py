"""Second-hand marketplace moderation, purchase and commission (criteria 10, 11)."""
from __future__ import annotations

from sqlalchemy import select

from app.models import CommissionRecord, Listing, ListingReport, Payout
from tests.conftest import csrf, login, make_user


def create_listing(client, *, price_paise=20000, title="Used Science Textbook"):
    payload = {
        "title": title,
        "condition": "good",
        "condition_notes": "Minor wear",
        "asking_price_paise": price_paise,
        "image_urls": ["/uploads/listings/example.jpg"],
        "class_level": "9",
        "subject": "Science",
        "board": "CBSE",
    }
    return client.post("/api/me/listings", json=payload, headers=csrf(client))


def approve(client, listing_id):
    return client.post(f"/api/admin/listings/{listing_id}/moderate", json={"status": "active", "note": "Looks good"}, headers=csrf(client))


def test_listing_requires_login_and_photo(client, db, shop):
    assert client.post("/api/me/listings", json={"title": "x"}, headers=csrf(client)).status_code == 401
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    no_photo = client.post(
        "/api/me/listings",
        json={"title": "No Photo Book", "condition": "good", "asking_price_paise": 10000},
        headers=csrf(client),
    )
    assert no_photo.status_code == 400
    assert "photograph" in no_photo.json()["detail"].lower()


def test_listing_is_hidden_until_moderated(client, db, shop):
    seller = make_user(db, email="seller@example.com", name="Seller One")
    login(client, "seller@example.com")
    created = create_listing(client)
    assert created.status_code == 201, created.text
    listing_id = created.json()["listing"]["id"]
    assert created.json()["listing"]["status"] == "pending_review"

    # Public browse shows nothing while pending
    assert client.get("/api/listings").json()["total"] == 0
    anonymous_view = client.get("/api/listings")
    assert anonymous_view.status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))
    assert client.get(f"/api/listings/{listing_id}").status_code == 404

    # Seller can still see their own pending listing
    login(client, "seller@example.com")
    assert client.get("/api/me/listings").json()["items"][0]["id"] == listing_id

    # Admin approves
    client.post("/api/auth/logout", headers=csrf(client))
    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    assert approve(client, listing_id).status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))

    assert client.get("/api/listings").json()["total"] == 1
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["status"] == "active"
    assert detail["seller_label"].startswith("Seller")  # first name only, no contact details
    assert "example.com" not in detail["seller_label"]
    assert "seller_id" not in str(detail.get("seller_label"))
    assert "@" not in str(detail)


def test_rejected_listing_is_not_public(client, db, shop):
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    listing_id = create_listing(client).json()["listing"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))
    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    rejected = client.post(f"/api/admin/listings/{listing_id}/moderate", json={"status": "rejected", "note": "Photos unclear"}, headers=csrf(client))
    assert rejected.status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))
    assert client.get("/api/listings").json()["total"] == 0


def test_seller_cannot_buy_own_listing_and_double_sale_is_blocked(client, db, shop):
    seller = make_user(db, email="seller@example.com")
    buyer = make_user(db, email="buyer@example.com")
    login(client, "seller@example.com")
    listing_id = create_listing(client, price_paise=30000).json()["listing"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))
    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    approve(client, listing_id)
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "seller@example.com")
    own = client.post(
        f"/api/listings/{listing_id}/purchase",
        json={"fulfillment_type": "pickup", "payment_method": "cod", "customer_name": "Seller", "customer_phone": "9876543210", "customer_email": "seller@example.com"},
        headers=csrf(client),
    )
    assert own.status_code == 400
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "buyer@example.com")
    purchase = client.post(
        f"/api/listings/{listing_id}/purchase",
        json={"fulfillment_type": "pickup", "payment_method": "cod", "customer_name": "Buyer", "customer_phone": "9876543210", "customer_email": "buyer@example.com"},
        headers=csrf(client),
    )
    assert purchase.status_code == 201, purchase.text
    order = purchase.json()["order"]
    assert order["order_type"] == "marketplace"
    assert order["total_paise"] == 30000

    # Commission: 10% of 30000 = 3000, seller proceeds 27000
    record = db.scalar(select(CommissionRecord).where(CommissionRecord.order_id == order["id"]))
    assert record.gross_paise == 30000
    assert record.commission_paise == 3000
    assert record.seller_proceeds_paise == 27000
    assert record.commission_rate_bp == 1000

    second = client.post(
        f"/api/listings/{listing_id}/purchase",
        json={"fulfillment_type": "pickup", "payment_method": "cod", "customer_name": "Buyer", "customer_phone": "9876543210", "customer_email": "buyer@example.com"},
        headers=csrf(client),
    )
    assert second.status_code == 409
    db.expire_all()
    assert db.scalar(select(Listing).where(Listing.id == listing_id)).status == "sold"


def test_marketplace_order_totals_include_delivery_but_commission_is_on_book_price(client, db, shop):
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    listing_id = create_listing(client, price_paise=50000).json()["listing"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))
    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    approve(client, listing_id)
    client.post("/api/auth/logout", headers=csrf(client))

    make_user(db, email="buyer@example.com")
    login(client, "buyer@example.com")
    from tests.conftest import address_payload

    purchase = client.post(
        f"/api/listings/{listing_id}/purchase",
        json={
            "fulfillment_type": "delivery",
            "payment_method": "cod",
            "customer_name": "Buyer",
            "customer_phone": "9876543210",
            "customer_email": "buyer@example.com",
            "address": address_payload(pincode="144005"),
        },
        headers=csrf(client),
    )
    assert purchase.status_code == 201, purchase.text
    order = purchase.json()["order"]
    assert order["delivery_fee_paise"] == 4900
    assert order["total_paise"] == 54900
    record = db.scalar(select(CommissionRecord).where(CommissionRecord.order_id == order["id"]))
    assert record.commission_paise == 5000


def test_report_listing_creates_moderation_queue_item(client, db, shop):
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    listing_id = create_listing(client).json()["listing"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))
    report = client.post(f"/api/listings/{listing_id}/report", json={"reason": "misleading_condition", "details": "Cover missing"}, headers=csrf(client))
    assert report.status_code == 201
    assert db.scalar(select(ListingReport)) is not None

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    queue = client.get("/api/admin/reports").json()["reports"]
    assert queue[0]["reason"] == "misleading_condition"


def test_seller_sees_recorded_sales_and_payout_marks_commission_paid(client, db, shop):
    seller = make_user(db, email="seller@example.com")
    make_user(db, email="buyer@example.com")
    login(client, "seller@example.com")
    listing_id = create_listing(client, price_paise=20000).json()["listing"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))
    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    approve(client, listing_id)
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "buyer@example.com")
    client.post(
        f"/api/listings/{listing_id}/purchase",
        json={"fulfillment_type": "pickup", "payment_method": "cod", "customer_name": "Buyer", "customer_phone": "9876543210", "customer_email": "buyer@example.com"},
        headers=csrf(client),
    )
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "seller@example.com")
    sales = client.get("/api/me/marketplace-sales").json()
    assert sales["totals"]["proceeds_paise"] == 18000
    assert sales["totals"]["commission_paise"] == 2000
    assert sales["totals"]["outstanding_paise"] == 18000
    assert "accounting" in sales["note"]
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "admin@example.com")
    payout = client.post("/api/admin/payouts", json={"seller_id": seller.id, "amount_paise": 18000, "reference": "NEFT-1"}, headers=csrf(client))
    assert payout.status_code == 201, payout.text
    commission = db.scalar(select(CommissionRecord))
    db.expire_all()
    assert db.get(CommissionRecord, commission.id).status == "paid"
    assert db.scalar(select(Payout)) is not None

    # Cannot record more than outstanding
    again = client.post("/api/admin/payouts", json={"seller_id": seller.id, "amount_paise": 100}, headers=csrf(client))
    assert again.status_code == 400


def test_book_submission_requires_moderation_and_can_be_converted(client, db, shop):
    seller = make_user(db, email="submitter@example.com")
    login(client, "submitter@example.com")
    submission = {
        "book_title": "Class 8 Maths Guide",
        "condition": "good",
        "expected_price_paise": 15000,
        "selling_method": "marketplace_listing",
        "contact_name": "Submitter",
        "contact_phone": "9876543210",
        "contact_email": "submitter@example.com",
        "photo_urls": ["/uploads/submissions/photo.jpg"],
    }
    created = client.post("/api/submissions", json=submission, headers=csrf(client))
    assert created.status_code == 201, created.text
    reference = created.json()["submission"]["reference"]
    assert created.json()["submission"]["contact_phone"] is None  # public payload hides contact
    assert "request" in created.json()["message"].lower() or "moderation" in created.json()["message"].lower()
    assert client.get("/api/listings").json()["total"] == 0  # nothing published

    mine = client.get("/api/me/submissions").json()["submissions"]
    assert mine[0]["reference"] == reference
    assert mine[0]["status"] == "submitted"
    client.post("/api/auth/logout", headers=csrf(client))

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    pending = client.get("/api/admin/submissions").json()["submissions"]
    submission_id = pending[0]["id"]
    review = client.post(f"/api/admin/submissions/{submission_id}/review", json={"status": "approved", "admin_note": "Good copy"}, headers=csrf(client))
    assert review.status_code == 200
    converted = client.post(f"/api/admin/submissions/{submission_id}/convert", json={"asking_price_paise": 15000}, headers=csrf(client))
    assert converted.status_code == 200, converted.text
    assert converted.json()["listing"]["status"] == "pending_review"
    listing_id = converted.json()["listing"]["id"]
    assert approve(client, listing_id).status_code == 200
    assert len(client.get("/api/listings").json()["items"]) == 1
    assert client.get("/api/admin/submissions").json()["submissions"][0]["status"] == "converted_to_listing"


def test_guest_cannot_create_listing(client, db, shop):
    response = create_listing(client)
    assert response.status_code == 401
