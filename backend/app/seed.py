"""Development / demo seed data.

Everything created here is **sample data** and only runs when ``SEED_DEMO=1``
or ``python -m app.cli seed-demo`` is executed explicitly. Demo mode is shown
as a banner in the storefront and flagged in admin store settings.

No orders, revenue, reviews or ratings are fabricated: those figures start at
zero and are populated by real transactions.

Credentials: the demo administrator password comes from ``DEMO_ADMIN_PASSWORD``
or is randomly generated and printed once to the console.
"""
from __future__ import annotations

import os
import secrets
import textwrap

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .config import settings
from .db import now
from .models import (
    Banner,
    BookSubmission,
    Category,
    Faq,
    Listing,
    ListingImage,
    Product,
    ProductImage,
    StoreSetting,
    User,
)
from .security import hash_password
from .services import settings as store_settings

DEMO_NOTICE = "SAMPLE DATA — demo mode. Replace before a real launch."


def _placeholder(title: str, subtitle: str, bg: tuple[int, int, int], subdir: str = "demo") -> str:
    """Generate an honest placeholder image (no fake product photography)."""
    width, height = 640, 800
    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)
    try:
        font_large = ImageFont.load_default(size=34)
        font_small = ImageFont.load_default(size=20)
        font_tiny = ImageFont.load_default(size=16)
    except TypeError:  # very old Pillow
        font_large = font_small = font_tiny = ImageFont.load_default()
    draw.rectangle([24, 24, width - 24, height - 24], outline=(255, 255, 255), width=2)
    y = 120
    for line in textwrap.wrap(title, 22)[:5]:
        draw.text((48, y), line, fill=(255, 255, 255), font=font_large)
        y += 44
    y += 24
    for line in textwrap.wrap(subtitle, 34)[:4]:
        draw.text((48, y), line, fill=(230, 235, 245), font=font_small)
        y += 28
    draw.text((48, height - 72), "Sample placeholder image", fill=(255, 255, 255), font=font_tiny)
    target = settings.upload_dir / subdir
    target.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(10)}.jpg"
    image.save(target / name, format="JPEG", quality=82)
    return f"/uploads/{subdir}/{name}"


CATEGORIES = [
    ("stationery", "Stationery", "Everyday writing and desk essentials.", (15, 45, 82)),
    ("notebooks", "Notebooks & Registers", "Ruled, unruled and subject notebooks.", (24, 62, 110)),
    ("pens-pencils", "Pens & Pencils", "Ball pens, gel pens, pencils and refills.", (14, 88, 96)),
    ("art-supplies", "Art Supplies", "Colours, brushes, sketchbooks and craft.", (122, 62, 20)),
    ("school-supplies", "School Supplies", "Geometry boxes, files, covers and more.", (64, 48, 110)),
    ("textbooks", "School Textbooks", "Board-wise and class-wise textbooks.", (20, 70, 50)),
    ("reference-books", "Reference & Guides", "Guides, workbooks and question banks.", (100, 30, 40)),
    ("office-supplies", "Office Supplies", "Files, staplers, paper and stationery.", (50, 55, 65)),
]

# (title, category, price_rupees, stock, extra fields)
PRODUCTS = [
    ("Classmate Ruled Notebook 172 Pages (Pack of 3)", "notebooks", 189, 40, {"is_featured": True, "compare_at_price": 225}),
    ("A4 Spiral Notebook 200 Pages", "notebooks", 120, 55, {}),
    ("Long Register 300 Pages", "notebooks", 165, 22, {}),
    ("Reynolds 045 Ball Pen (Pack of 10)", "pens-pencils", 100, 120, {"is_featured": True}),
    ("Cello Butterflow Ball Pen (Blue, Pack of 5)", "pens-pencils", 60, 80, {}),
    ("Camlin Kokuyo Geometry Box", "school-supplies", 245, 18, {"is_featured": True}),
    ("Apsara Platinum Extra Dark Pencils (Pack of 10)", "school-supplies", 90, 70, {}),
    ("Faber-Castell Watercolour Cake Set", "art-supplies", 275, 12, {}),
    ("Camlin Drawing Book A4 (36 Sheets)", "art-supplies", 85, 34, {}),
    ("A4 Copier Paper 75 GSM (500 Sheets)", "office-supplies", 370, 25, {}),
    ("Kangaro Stapler No. 10 with Pins", "office-supplies", 110, 30, {}),
    ("Box File with Clip (Pack of 2)", "office-supplies", 220, 15, {}),
    ("Clear Book Cover Roll (10 metres)", "school-supplies", 130, 40, {}),
    ("Whiteboard Marker Set (4 Colours)", "stationery", 160, 26, {}),
    ("Glue Stick 15 g (Pack of 3)", "stationery", 105, 0, {"note": "Out of stock sample"}),
    ("Pencil Sharpener & Eraser Combo", "stationery", 35, 90, {}),

    # Textbooks — sample catalogue entries, clearly marked demo data
    ("CBSE Class 6 Mathematics Textbook", "textbooks", 395, 14, {
        "isbn": "9780000000011", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "CBSE", "class_level": "6", "subject": "Mathematics", "book_type": "textbook",
        "academic_year": "2025-26", "edition": "2025", "language": "English", "publication_year": 2025,
        "is_featured": True,
    }),
    ("CBSE Class 6 Science Textbook", "textbooks", 410, 14, {
        "isbn": "9780000000012", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "CBSE", "class_level": "6", "subject": "Science", "book_type": "textbook",
        "academic_year": "2025-26", "language": "English", "publication_year": 2025,
    }),
    ("CBSE Class 10 Mathematics Question Bank", "textbooks", 520, 9, {
        "isbn": "9780000000013", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "CBSE", "class_level": "10", "subject": "Mathematics", "book_type": "question_bank",
        "academic_year": "2025-26", "language": "English", "publication_year": 2025,
    }),
    ("ICSE Class 8 English Workbook", "textbooks", 340, 6, {
        "isbn": "9780000000014", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "ICSE/ISC", "class_level": "8", "subject": "English", "book_type": "workbook",
        "academic_year": "2025-26", "language": "English", "publication_year": 2025,
    }),
    ("PSEB Class 5 Punjabi Guide", "textbooks", 260, 0, {
        "isbn": "9780000000015", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "PSEB", "class_level": "5", "subject": "Punjabi", "book_type": "guide",
        "academic_year": "2025-26", "language": "Punjabi", "publication_year": 2025,
    }),
    ("CBSE Class 12 Physics Reference Book", "reference-books", 780, 5, {
        "isbn": "9780000000016", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "CBSE", "class_level": "12", "subject": "Physics", "book_type": "reference",
        "language": "English", "publication_year": 2024,
    }),
    ("ICSE Class 10 Chemistry Guide", "reference-books", 610, 3, {
        "isbn": "9780000000017", "author": "Sample Author", "publisher": "Sample Publications",
        "board": "ICSE/ISC", "class_level": "10", "subject": "Chemistry", "book_type": "guide",
        "language": "English", "publication_year": 2024,
    }),
    ("Competitive Exam General Knowledge Workbook", "reference-books", 450, 0, {
        "isbn": "9780000000018", "author": "Sample Author", "publisher": "Sample Publications",
        "book_type": "workbook", "language": "English", "publication_year": 2024,
        "is_enquiry_only": True,
    }),
    ("Long Notebook Bundle — Store Second-Hand Copy", "notebooks", 70, 3, {
        "product_type": "used", "condition": "good",
    }),
    ("Second-Hand CBSE Class 9 Science Textbook", "textbooks", 210, 2, {
        "product_type": "used", "condition": "like_new", "board": "CBSE", "class_level": "9",
        "subject": "Science", "book_type": "textbook", "author": "Sample Author",
        "publisher": "Sample Publications", "isbn": "9780000000019",
    }),
]

LISTINGS = [
    ("CBSE Class 10 Mathematics Textbook (2024 edition)", "like_new", 260, "Barely used; no writing inside.", "10", "Mathematics", "CBSE", "active"),
    ("ICSE Class 9 English Literature Guide", "good", 180, "Highlighted in two chapters, otherwise clean.", "9", "English", "ICSE/ISC", "active"),
    ("Class 7 Science Reference Book", "acceptable", 120, "Cover worn, all pages intact.", "7", "Science", "CBSE", "active"),
    ("PSEB Class 10 Punjabi Textbook", "good", 150, "Name written on first page.", "10", "Punjabi", "PSEB", "pending_review"),
]

FAQS = [
    ("What are your opening hours?", "Opening hours are not published yet. The store owner can set them in Admin → Settings, and they will appear here.", "Store"),
    ("How do I submit a used book for sale?", "Use Sell Your Books. The store reviews every submission; nothing is published until it is approved.", "Second-hand"),
    ("Do you deliver?", "Delivery areas, charges and eligibility are configured by the store. If delivery is not configured, the checkout offers store pickup only.", "Orders"),
    ("Can I cancel an order?", "Self-service cancellation is offered only when the store has configured a cancellation window. Otherwise contact the store.", "Orders"),
]


def seed_demo(db: OrmSession) -> dict:
    """Idempotent demo seed. Returns a summary dict."""
    if db.scalar(select(Product.id).limit(1)):
        return {"skipped": True, "reason": "Catalogue already contains products"}

    admin_email = (os.getenv("DEMO_ADMIN_EMAIL") or settings.admin_bootstrap_email or "demo.admin@example.com").lower()
    admin_password = os.getenv("DEMO_ADMIN_PASSWORD") or secrets.token_urlsafe(12)
    customer_password = os.getenv("DEMO_CUSTOMER_PASSWORD") or secrets.token_urlsafe(12)

    store_settings.set_many(
        db,
        {
            "demo_mode": True,
            "store_phone": "Not configured (demo)",
            "store_email": "demo.store@example.com",
            "store_opening_hours": "Sample: Mon–Sat 10:00–19:00 (not verified)",
            "delivery_enabled": True,
            "delivery_fee_paise": 4900,
            "free_delivery_threshold_paise": 99900,
            "delivery_pincodes": ["144001", "144002", "144003", "144004", "144005", "144006"],
            "pickup_enabled": True,
            "pickup_instructions": "Collect from the counter during store hours. This instruction is sample data.",
            "cod_enabled": True,
            "marketplace_enabled": True,
            "marketplace_commission_bp": 1000,
            "marketplace_note": "Sample policy: a 10% platform commission applies to marketplace sales. Replace with the store's actual terms.",
            "cancellation_window_hours": 12,
            "return_window_days": 7,
            "returns_note": "Sample policy: returns accepted within 7 days of delivery for unused items in original condition. Replace before launch.",
            "shipping_note": "Sample policy: local delivery within serviceable PIN codes; charges shown at checkout.",
            "announcement": "Demo storefront with sample catalogue — not live business data.",
            "seo_description": "Demo storefront for Ankit Stationery Mart, Jalandhar Cantt.",
        },
    )

    admin = User(
        email=admin_email,
        full_name="Demo Administrator",
        password_hash=hash_password(admin_password),
        role="admin",
        status="active",
        phone=None,
    )
    customer = User(
        email="demo.customer@example.com",
        full_name="Demo Customer",
        password_hash=hash_password(customer_password),
        role="customer",
        status="active",
    )
    seller = User(
        email="demo.seller@example.com",
        full_name="Demo Seller",
        password_hash=hash_password(customer_password),
        role="customer",
        status="active",
    )
    db.add_all([admin, customer, seller])
    db.commit()

    categories: dict[str, Category] = {}
    for slug, name, description, colour in CATEGORIES:
        category = Category(
            slug=slug,
            name=name,
            description=description,
            image_url=_placeholder(name, DEMO_NOTICE, colour, "demo/categories"),
            sort_order=len(categories),
        )
        db.add(category)
        categories[slug] = category
    db.commit()

    created_products = 0
    for index, (title, category_slug, price, stock, extra) in enumerate(PRODUCTS):
        product_type = extra.get("product_type", "new")
        condition = extra.get("condition", "new")
        compare = extra.get("compare_at_price")
        slug_base = title.lower().replace("&", "and")
        slug = "".join(ch if ch.isalnum() else "-" for ch in slug_base)
        while "--" in slug:
            slug = slug.replace("--", "-")
        slug = slug.strip("-")[:150]
        if db.scalar(select(Product.id).where(Product.slug == slug)):
            slug = f"{slug[:140]}-{index}"
        product = Product(
            slug=slug,
            title=title,
            description=(
                f"{title}.\n\n{DEMO_NOTICE} This description, price and stock level are sample "
                "data supplied for development and must be replaced with verified business information."
            ),
            category_id=categories[category_slug].id,
            sku=f"DEMO-{1000 + index}" if product_type == "new" else None,
            isbn=extra.get("isbn"),
            product_type=product_type,
            condition=condition,
            author=extra.get("author"),
            publisher=extra.get("publisher"),
            subject=extra.get("subject"),
            board=extra.get("board"),
            class_level=extra.get("class_level"),
            book_type=extra.get("book_type"),
            edition=extra.get("edition"),
            language=extra.get("language"),
            publication_year=extra.get("publication_year"),
            academic_year=extra.get("academic_year"),
            price_paise=price * 100,
            compare_at_price_paise=compare * 100 if compare else None,
            cost_paise=None,
            stock_qty=stock,
            low_stock_threshold=5,
            status="active",
            is_featured=bool(extra.get("is_featured")),
            is_enquiry_only=bool(extra.get("is_enquiry_only")),
            created_by=admin.id,
        )
        db.add(product)
        db.flush()
        colour = (15, 45, 82) if product_type == "new" else (95, 70, 40)
        image_url = _placeholder(title, f"{category_slug.replace('-', ' ').title()} · {DEMO_NOTICE}", colour)
        db.add(ProductImage(product_id=product.id, url=image_url, alt_text=f"Sample placeholder image for {title}", sort_order=0))
        created_products += 1
    db.commit()

    db.add_all(
        [
            Banner(
                title="Demo banner: school season checklist",
                subtitle="Sample promotional copy managed from the admin panel.",
                cta_label="Browse school supplies",
                cta_url="/products?category=school-supplies",
                theme="navy",
                sort_order=0,
                image_url=_placeholder("School season", DEMO_NOTICE, (18, 52, 92)),
            ),
            Banner(
                title="Sell your used books",
                subtitle="Submit a book for review — it appears only after the store approves it.",
                cta_label="Submit a book",
                cta_url="/sell-books",
                theme="orange",
                sort_order=1,
            ),
        ]
    )
    for index, (question, answer, category) in enumerate(FAQS):
        db.add(Faq(question=f"{question} (sample)", answer=answer, category=category, sort_order=index))
    db.commit()

    for index, (title, condition, price, notes, class_level, subject, board, status) in enumerate(LISTINGS):
        listing = Listing(
            listing_code=f"UB-DEMO{index + 1:02d}",
            seller_id=seller.id,
            title=title,
            condition=condition,
            condition_notes=notes,
            asking_price_paise=price * 100,
            class_level=class_level,
            subject=subject,
            board=board,
            status=status,
            published_at=now() if status == "active" else None,
            author="Sample Author",
        )
        db.add(listing)
        db.flush()
        db.add(
            ListingImage(
                listing_id=listing.id,
                url=_placeholder(title, f"Second-hand listing · {DEMO_NOTICE}", (90, 65, 35), "demo/listings"),
                alt_text=f"Sample photograph placeholder for {title}",
                sort_order=0,
            )
        )
    db.commit()

    db.add(
        BookSubmission(
            reference="BK-DEMO01",
            user_id=seller.id,
            book_title="CBSE Class 9 Social Science Textbook",
            condition="good",
            expected_price_paise=15000,
            selling_method="marketplace_listing",
            contact_name="Demo Seller",
            contact_phone="9876543210",
            contact_email="demo.seller@example.com",
            notes="Sample submission awaiting moderation.",
            status="submitted",
            photos=[_placeholder("Class 9 SST", DEMO_NOTICE, (80, 60, 40), "demo/submissions")],
        )
    )
    db.commit()

    store_settings.set_many(db, {"demo_mode": True})
    return {
        "skipped": False,
        "products": created_products,
        "categories": len(categories),
        "admin_email": admin_email,
        "admin_password": admin_password,
        "demo_customer_email": customer.email,
        "demo_customer_password": customer_password,
        "notice": DEMO_NOTICE,
    }
