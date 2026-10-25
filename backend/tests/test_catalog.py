"""Catalogue search, filtering, sorting and availability (acceptance criterion 4)."""
from __future__ import annotations

from tests.conftest import add_to_cart, csrf, make_category, make_product


def seed_catalogue(db):
    books = make_category(db, slug="textbooks", name="Textbooks")
    pens = make_category(db, slug="pens-pencils", name="Pens")
    make_product(
        db,
        title="CBSE Class 6 Mathematics Textbook",
        slug="cbse-class-6-maths",
        category=books,
        price_paise=39500,
        stock=5,
        board="CBSE",
        class_level="6",
        subject="Mathematics",
        author="Sample Author",
        publisher="Sample Publications",
        isbn="9780000000011",
        book_type="textbook",
    )
    make_product(
        db,
        title="ICSE Class 8 English Workbook",
        slug="icse-class-8-english",
        category=books,
        price_paise=34000,
        stock=0,
        board="ICSE/ISC",
        class_level="8",
        subject="English",
        author="Another Author",
        isbn="9780000000014",
        book_type="workbook",
    )
    make_product(
        db,
        title="Reynolds Ball Pen Pack",
        slug="reynolds-pen-pack",
        category=pens,
        price_paise=10000,
        stock=50,
        sku="PEN-001",
    )
    return books, pens


def test_search_matches_title_author_isbn_and_sku(client, db):
    seed_catalogue(db)
    by_title = client.get("/api/products?q=mathematics").json()
    assert by_title["total"] == 1
    assert by_title["items"][0]["slug"] == "cbse-class-6-maths"

    assert client.get("/api/products?q=Another+Author").json()["total"] == 1
    assert client.get("/api/products?q=9780000000014").json()["total"] == 1
    assert client.get("/api/products?q=PEN-001").json()["total"] == 1
    assert client.get("/api/products?q=nothing-matches").json()["total"] == 0


def test_filters_combine_correctly(client, db):
    seed_catalogue(db)
    assert client.get("/api/products?board=CBSE").json()["total"] == 1
    assert client.get("/api/products?class_level=8&board=ICSE%2FISC").json()["total"] == 1
    assert client.get("/api/products?category=pens-pencils").json()["total"] == 1
    assert client.get("/api/products?min_price=30000&max_price=40000").json()["total"] == 2
    assert client.get("/api/products?availability=in_stock").json()["total"] == 2
    out = client.get("/api/products?availability=out_of_stock").json()
    assert out["total"] == 1
    assert out["items"][0]["availability"]["can_buy"] is False


def test_sorting_and_pagination(client, db):
    seed_catalogue(db)
    ascending = client.get("/api/products?sort=price_asc&per_page=2").json()
    assert [i["price_paise"] for i in ascending["items"]] == [10000, 34000]
    assert ascending["pages"] == 2
    descending = client.get("/api/products?sort=price_desc").json()
    assert descending["items"][0]["price_paise"] == 39500
    page_two = client.get("/api/products?sort=price_asc&per_page=2&page=2").json()
    assert [i["price_paise"] for i in page_two["items"]] == [39500]


def test_out_of_stock_item_cannot_be_added_to_cart(client, db):
    seed_catalogue(db)
    item = client.get("/api/products?q=icse-class-8-english").json()["items"][0]
    assert item["availability"]["state"] == "out_of_stock"
    response = add_to_cart(client, item["id"], 1)
    assert response.status_code == 409


def test_enquiry_only_product_cannot_be_bought(client, db):
    category = make_category(db)
    product = make_product(db, title="Enquiry Item", stock=4, is_enquiry_only=True)
    card = client.get("/api/products?q=Enquiry").json()["items"][0]
    assert card["availability"]["state"] == "enquiry_only"
    assert add_to_cart(client, product.id, 1).status_code == 409


def test_archived_and_draft_products_are_hidden(client, db):
    category = make_category(db)
    archived = make_product(db, title="Archived Book", slug="archived-book", status="archived", category=category)
    draft = make_product(db, title="Draft Book", slug="draft-book", status="draft", category=category)
    assert client.get("/api/products/archived-book").status_code == 410
    assert client.get("/api/products/draft-book").status_code == 404
    assert client.get("/api/products").json()["total"] == 0


def test_book_lists_report_live_availability(client, db):
    seed_catalogue(db)
    payload = client.get("/api/book-lists").json()
    assert payload["has_data"] is True
    boards = {b["board"]: b for b in payload["boards"]}
    assert boards["CBSE"]["total"] == 1
    assert boards["ICSE/ISC"]["in_stock"] == 0
    assert boards["ICSE/ISC"]["classes"][0]["class_level"] == "8"


def test_home_payload_hides_bestsellers_without_sales(client, db):
    seed_catalogue(db)
    payload = client.get("/api/store/home").json()
    assert payload["has_sales_data"] is False
    assert payload["bestsellers"] == []
    assert len(payload["new_arrivals"]) == 3
    assert payload["featured"] == []


def test_search_suggestions(client, db):
    seed_catalogue(db)
    payload = client.get("/api/products/suggest?q=pen").json()
    assert payload["products"][0]["title"] == "Reynolds Ball Pen Pack"


def test_csrf_is_required_for_mutations(client, db):
    seed_catalogue(db)
    item = client.get("/api/products").json()["items"][0]
    response = client.post("/api/cart/items", json={"product_id": item["id"], "quantity": 1})
    assert response.status_code == 403
    response = client.post(
        "/api/cart/items",
        json={"product_id": item["id"], "quantity": 1},
        headers={"X-CSRF-Token": "wrong-token"},
    )
    assert response.status_code == 403
