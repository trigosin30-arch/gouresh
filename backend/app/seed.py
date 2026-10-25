"""Idempotent demo catalogue for Ankit Stationery Mart.

Prices are in paise. Images are generated locally by `scripts/make_images.py`
and served from the frontend's `public/images` folder, so the demo has no
external image dependency (swap the URLs for Supabase Storage paths later).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Category, Coupon, Product, Profile
from .services.orders import unique_slug

CATEGORIES = [
    ("School Textbooks", "school-textbooks", "HP Board, CBSE and ICSE textbooks for classes 1-12."),
    ("Notebooks & Registers", "notebooks-registers", "Ruled, squared and practical notebooks by the pack."),
    ("Writing Instruments", "writing-instruments", "Pens, pencils, gel rollers and refills that actually last."),
    ("Art & Craft", "art-craft", "Colours, brushes, chart paper and craft supplies for project week."),
    ("Office Supplies", "office-supplies", "Files, staplers, printing paper and desk essentials."),
    ("Exam & Competition", "exam-competition", "JEE, NEET, HPPSC guides, previous-year papers and mock sets."),
]

PRODUCTS = [
    # name, sku, category slug, price, mrp, stock, unit, image, featured, brand, tags, extra
    ("Class 10 Mathematics — HP Board Textbook", "ASM-BK-1001", "school-textbooks", 28500, 32000, 24, "each",
     "class-10-maths.jpg", True, "Himachal Board", "class 10,board,mathematics,textbook",
     {"class_level": "Class 10", "board": "HP Board", "author": "HPBSE", "isbn": "9788195001011"}),
    ("Class 12 Physics Part 1 & 2 (Set)", "ASM-BK-1202", "school-textbooks", 64000, 72000, 12, "set",
     "class-12-physics.jpg", True, "NCERT", "class 12,physics,ncert,set",
     {"class_level": "Class 12", "board": "CBSE", "author": "NCERT", "isbn": "9788195001028"}),
    ("Class 8 Science — CBSE Edition", "ASM-BK-0803", "school-textbooks", 31500, 35000, 18, "each",
     "class-8-science.jpg", False, "NCERT", "class 8,science,cbse",
     {"class_level": "Class 8", "board": "CBSE", "author": "NCERT", "isbn": "9788195001035"}),
    ("Class 5 English Reader + Workbook", "ASM-BK-0504", "school-textbooks", 24000, None, 30, "set",
     "class-5-english.jpg", False, "Oxford", "class 5,english,workbook",
     {"class_level": "Class 5", "board": "ICSE", "author": "Oxford University Press"}),

    ("Ruled Notebook — 172 pages (Pack of 6)", "ASM-NB-2001", "notebooks-registers", 33000, 42000, 40, "pack of 6",
     "ruled-notebook-pack.jpg", True, "Classmate", "notebook,ruled,pack,school",
     {}),
    ("Practical Notebook — 100 pages", "ASM-NB-2002", "notebooks-registers", 6500, 8000, 60, "each",
     "practical-notebook.jpg", False, "Navneet", "practical,lab,notebook",
     {}),
    ("Spiral Register — 300 pages", "ASM-NB-2003", "notebooks-registers", 18500, 21000, 26, "each",
     "spiral-register.jpg", False, "Camlin", "register,spiral,office",
     {}),
    ("Long Book (Pack of 4)", "ASM-NB-2004", "notebooks-registers", 21000, 24000, 4, "pack of 4",
     "long-book-pack.jpg", False, "Classmate", "long book,notebook,pack",
     {}),

    ("Gel Pen 0.5mm — Blue (Pack of 10)", "ASM-WR-3001", "writing-instruments", 12000, 15000, 55, "pack of 10",
     "gel-pen-blue.jpg", True, "Pentonic", "pen,gel,blue,writing",
     {}),
    ("HB Pencil Box of 10", "ASM-WR-3002", "writing-instruments", 7500, 9000, 48, "box of 10",
     "pencils-hb.jpg", False, "Apsara", "pencil,hb,drawing",
     {}),
    ("Mechanical Pencil 0.7mm + 10 Leads", "ASM-WR-3003", "writing-instruments", 9500, None, 22, "each",
     "mechanical-pencil.jpg", False, "Camlin", "mechanical pencil,leads",
     {}),
    ("Permanent Marker Set (4 colours)", "ASM-WR-3004", "writing-instruments", 16000, 19000, 0, "set",
     "marker-set.jpg", False, "Faber-Castell", "marker,permanent,set",
     {}),

    ("Watercolour Cake Set — 24 Shades", "ASM-AR-4001", "art-craft", 27500, 34000, 16, "set",
     "watercolour-24.jpg", True, "Camlin", "watercolour,painting,art",
     {}),
    ("Chart Paper Assorted (Pack of 10)", "ASM-AR-4002", "art-craft", 9000, 11000, 60, "pack of 10",
     "chart-paper.jpg", False, "Asm Select", "chart paper,project,craft",
     {}),
    ("Brush Set for Students (7 pieces)", "ASM-AR-4003", "art-craft", 14000, None, 14, "set",
     "brush-set.jpg", False, "Camel", "brush,painting,art",
     {}),
    ("Craft Paper Stickers & Glue Kit", "ASM-AR-4004", "art-craft", 11500, 13500, 3, "kit",
     "craft-kit.jpg", False, "Asm Select", "craft,stickers,glue,project",
     {}),

    ("A4 Printing Paper — 75 GSM (500 sheets)", "ASM-OF-5001", "office-supplies", 32000, 38000, 20, "ream",
     "a4-paper-ream.jpg", True, "JK Copier", "a4,paper,printer,office",
     {}),
    ("Box File with Clip — Pack of 3", "ASM-OF-5002", "office-supplies", 24000, 28000, 17, "pack of 3",
     "box-file.jpg", False, "Solo", "file,box file,office",
     {}),
    ("Heavy Duty Stapler + 1000 Pins", "ASM-OF-5003", "office-supplies", 19000, 22000, 11, "set",
     "stapler-set.jpg", False, "Kangaro", "stapler,pins,office",
     {}),
    ("Whiteboard Marker Set (4)", "ASM-OF-5004", "office-supplies", 13500, None, 25, "set",
     "whiteboard-markers.jpg", False, "Camlin", "whiteboard,marker,office",
     {}),

    ("HPPSC Previous Year Papers — Vol 1", "ASM-EX-6001", "exam-competition", 42000, 48000, 9, "each",
     "hppsc-papers.jpg", True, "Asm Select", "hppsc,exam,papers,himachal",
     {"author": "Asm Editorial"}),
    ("JEE Main Mock Test Series 2026", "ASM-EX-6002", "exam-competition", 52000, 60000, 7, "each",
     "jee-mock-series.jpg", False, "Arihant", "jee,exam,mock,2026",
     {"author": "Arihant Experts"}),
    ("NEET Biology Quick Revision Notes", "ASM-EX-6003", "exam-competition", 36000, 40000, 13, "each",
     "neet-biology.jpg", False, "MTG", "neet,biology,revision",
     {"author": "MTG Editorial"}),
    ("Hindi Vyakaran Practice Book — Class 9-10", "ASM-EX-6004", "exam-competition", 22000, 25000, 15, "each",
     "hindi-vyakaran.jpg", False, "Everest", "hindi,vyakaran,grammar",
     {"class_level": "Class 10", "board": "HP Board"}),
]

DESCRIPTIONS = {
    "school-textbooks": "Prescribed school textbook, sourced fresh for this academic session. "
                        "Cover and pages inspected in-store before dispatch.",
    "notebooks-registers": "Millimetre-perfect ruling, sturdy binding and paper that does not bleed "
                           "through with gel pens or sketch pens.",
    "writing-instruments": "Smooth, consistent ink flow with a comfort grip — the everyday favourite "
                           "for long writing sessions.",
    "art-craft": "Student-grade art supplies selected for project week, class exhibitions and "
                 "summer workshops at the store.",
    "office-supplies": "Practical desk and filing essentials for the shop, office and study table.",
    "exam-competition": "Curated exam preparation material, updated for the current session and "
                        "available off the shelf in Shimla.",
}


def seed(db: Session) -> None:
    categories: dict[str, Category] = {}
    for order, (name, slug, description) in enumerate(CATEGORIES):
        category = db.scalar(select(Category).where(Category.slug == slug))
        if category is None:
            category = Category(name=name, slug=slug, description=description, sort_order=order)
            db.add(category)
            db.flush()
        categories[slug] = category

    for spec in PRODUCTS:
        (
            name, sku, category_slug, price, mrp, stock, unit, image, featured, brand, tags, extra,
        ) = spec
        if db.scalar(select(Product).where(Product.sku == sku)):
            continue
        product = Product(
            sku=sku,
            slug=unique_slug(db, name),
            name=name,
            description=DESCRIPTIONS.get(category_slug, ""),
            category_id=categories[category_slug].id,
            price_paise=price,
            mrp_paise=mrp,
            stock=stock,
            unit=unit,
            brand=brand,
            tags=tags,
            image_url=f"/images/products/{image}",
            is_featured=featured,
            sold_count=(stock * 3) % 41,
            **extra,
        )
        db.add(product)

    coupons = [
        ("ASM10", "percent", 10, 49900, 15000),
        ("SHIMLA50", "flat", 5000, 99900, 5000),
        ("WELCOME25", "flat", 2500, 29900, 2500),
    ]
    for code, kind, value, min_subtotal, max_discount in coupons:
        if not db.scalar(select(Coupon).where(Coupon.code == code)):
            db.add(
                Coupon(
                    code=code,
                    kind=kind,
                    value=value,
                    min_subtotal_paise=min_subtotal,
                    max_discount_paise=max_discount if kind == "percent" else None,
                )
            )

    # A visible staff account makes the admin dashboard reachable in the demo
    # even if a customer signs in first.
    if not db.scalar(select(Profile).where(Profile.email == "owner@ankitstationery.in")):
        db.add(
            Profile(
                email="owner@ankitstationery.in",
                full_name="Ankit Sharma (Owner)",
                role="admin",
            )
        )
    db.commit()
