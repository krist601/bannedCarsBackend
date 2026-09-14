# Banned Cards custom catalogue ERD

This diagram contains only the tables defined by the Banned Cards `tcg-catalog` module. Medusa core tables are intentionally omitted.

```mermaid
erDiagram
    tcg_game ||--o{ tcg_set : "game_id"
    tcg_game ||--o{ card_printing : "game_id"
    tcg_game o|--o{ catalog_product : "game_id"
    tcg_set ||--o{ card_printing : "set_id"
    card_printing ||--o{ card_listing : "printing_id"
    catalog_product ||--o{ catalog_listing : "catalog_product_id"

    tcg_game {
        text id PK
        text handle UK
        text name
        text publisher
        jsonb metadata
    }

    tcg_set {
        text id PK
        text game_id FK
        text code
        text name
        timestamptz released_at
        jsonb metadata
    }

    card_printing {
        text id PK
        text game_id FK
        text set_id FK
        text collector_number
        text name
        text rarity
        text external_id
        text image_source
        text image_url
        text image_small_url
        jsonb attributes
    }

    card_listing {
        text id PK
        text printing_id FK
        text product_id
        text variant_id
        text sku UK
        enum condition
        text language
        enum finish
        integer price_clp
        integer quantity
        text storage_location
        jsonb photos
        jsonb metadata
    }

    catalog_product {
        text id PK
        text game_id FK
        enum kind
        text title
        text handle UK
        text description
        jsonb attributes
        jsonb metadata
    }

    catalog_listing {
        text id PK
        text catalog_product_id FK
        text product_id
        text variant_id
        text sku UK
        text condition
        text language
        text finish
        integer price_clp
        integer quantity
        jsonb photos
        jsonb metadata
    }
```

The arrows describe the intended catalogue relationships. At present, the module stores relationship IDs as indexed `text` columns; PostgreSQL foreign-key constraints are not defined for them. The `product_id` and `variant_id` fields on both listing tables point to Medusa core records, which are outside this custom-only diagram.

All six tables also receive Medusa's standard `created_at`, `updated_at`, and nullable `deleted_at` columns.

## Reading the model

- A game has sets, card printings, and optional generic catalogue products.
- A set contains card printings. The 856 imported LTR records are in `card_printing`.
- A card printing can have multiple sellable listings for different conditions, languages, or finishes.
- A generic catalogue product represents a single, sealed product, or accessory and can have multiple catalogue listings.
- Listings carry the local CLP price and quantity while their optional Medusa IDs connect them to checkout and inventory.
