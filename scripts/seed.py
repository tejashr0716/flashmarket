import random
from decimal import Decimal


BRANDS = ["Northstar", "Kanso", "Oakline", "Helio", "Morrow", "Terrain", "Atelier", "Nova"]
TREE = {
    "Electronics": {
        "Computers": ["Laptops", "Keyboards", "Monitors"],
        "Audio": ["Headphones", "Speakers", "Microphones"],
        "Mobile": ["Smartphones", "Chargers", "Wearables"],
    },
    "Home": {
        "Kitchen": ["Cookware", "Coffee Makers", "Storage"],
        "Living": ["Lighting", "Chairs", "Tables"],
        "Care": ["Vacuum Cleaners", "Air Purifiers", "Fans"],
    },
    "Lifestyle": {
        "Outdoor": ["Backpacks", "Camping", "Cycling"],
        "Fitness": ["Yoga", "Weights", "Running"],
        "Essentials": ["Watches", "Bottles", "Travel"],
    },
}


def sample_records():
    rng = random.Random(202505)
    categories = []
    leaves = []
    category_id = 0
    for root, children in TREE.items():
        category_id += 1
        root_id = category_id
        categories.append((root_id, root, None, 1))
        for middle, names in children.items():
            category_id += 1
            parent_id = category_id
            categories.append((parent_id, middle, root_id, 2))
            for name in names:
                category_id += 1
                categories.append((category_id, name, parent_id, 3))
                leaves.append((category_id, name))
    variants = ["Essential", "Studio", "Everyday", "Compact", "Classic", "Pro"]
    finishes = ["Slate", "Sand", "Cloud", "Forest", "Ink"]
    products = []
    for i in range(1, 601):
        leaf_id, leaf_name = leaves[(i - 1) % len(leaves)]
        brand_id = rng.randint(1, len(BRANDS))
        name = f"{BRANDS[brand_id - 1]} {leaf_name} {rng.choice(variants)} — {rng.choice(finishes)} {i:03d}"
        # Synthetic products, not scraped stock, orders, customers, or reviews.
        price = Decimal(rng.randint(49900, 11999900)) / 100
        stock = 0 if i % 11 == 0 else rng.randint(1, 5) if i % 7 == 0 else rng.randint(6, 120)
        rating = Decimal(rng.randint(20, 50)) / 10
        products.append((
            f"FM-{i:05d}", name,
            f"Sample {leaf_name.lower()} for testing catalog filters and inventory workflows. Not a real listing.",
            leaf_id, brand_id, price, stock, rating,
        ))
    return categories, list(enumerate(BRANDS, 1)), products


def seed_catalog(database):
    with database.connection() as connection, connection.cursor(dictionary=True) as cursor:
        cursor.execute("SELECT metadata_value FROM app_metadata WHERE metadata_key = 'sample_seed_v1'")
        if cursor.fetchone():
            return False
        cursor.execute("""
            SELECT (SELECT COUNT(*) FROM products) +
                   (SELECT COUNT(*) FROM categories) +
                   (SELECT COUNT(*) FROM brands) AS existing
        """)
        if cursor.fetchone()["existing"]:
            raise RuntimeError("Refusing to seed an existing unmarked catalog. No data was overwritten.")
        categories, brands, products = sample_records()
        cursor.executemany("INSERT INTO brands (id, name) VALUES (%s, %s)", brands)
        # Insert parents before their children so self-referencing FKs are valid.
        for category in categories:
            cursor.execute(
                "INSERT INTO categories (id, name, parent_id, depth) VALUES (%s, %s, %s, %s)", category,
            )
        cursor.executemany("""
            INSERT INTO products (sku, name, description, category_id, brand_id, price, stock, rating, is_sample)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1)
        """, products)
        cursor.execute(
            "INSERT INTO app_metadata (metadata_key, metadata_value) VALUES ('sample_seed_v1', '600')"
        )
        connection.commit()
    return True
