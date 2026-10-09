# Banned Cards server

This separate Medusa v2 service owns the data and operations that must be trusted: products, CLP prices, inventory, carts, customers, orders, payment state, refunds, and stock reservations. The Next.js storefront only calls the Store API.

## Local services

PostgreSQL and Redis run in Docker. The backend runs on the Mac for fast development.

```sh
pnpm install
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev
```

- Medusa API and Admin: `http://localhost:9000`
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6380`

The local admin credentials are stored only in the ignored `.env` file. Create or replace the user with:

```sh
set -a
source .env
set +a
pnpm exec medusa user --email "$DEV_ADMIN_EMAIL" --password "$DEV_ADMIN_PASSWORD"
```

The nonstandard database and Redis ports avoid conflicts with other local projects. `.env` contains local-only development credentials and is ignored by Git. Replace all secrets for any deployed environment.

Redis currently stores server sessions. Before production, configure Medusa's Redis event bus, workflow engine, cache, and locking providers, and run separate server and worker processes.

## Ownership and transactions

Medusa core product variants, price sets, inventory levels, carts, orders, payment collections, and reservations are authoritative. Use Medusa workflows and module services for multi-step changes so PostgreSQL transactions and compensating actions remain inside the backend. Do not let the storefront write the database or mark orders paid.

`tcg-catalog` stores card identity and merchandising data. A listing links to its Medusa core `product_id` and `variant_id`. Core Medusa inventory and pricing remain the checkout source of truth.

See [the custom catalogue relationship diagram](docs/custom-catalog-erd.md) for the six Banned Cards tables without the Medusa core schema.

Import the [Postman collection and local environment](postman/README.md) to exercise the storefront-facing API and its customer, cart, checkout, order, and return flows.

## Card data and images

Use Scryfall as the initial Magic data and image provider. Store these fields on each printing:

- `external_id`: Scryfall card ID
- `image_source`: `scryfall`
- `image_url` and `image_small_url`: the returned image URLs
- collector number, set code, name, rarity, and Oracle/game attributes

Do not query Scryfall on every storefront page. Import or refresh card records in a background/admin workflow, cache the result in PostgreSQL, and respect Scryfall's API limits. Use bulk data for large imports.

Store catalogue images outside the frontend repository. The backend uses Medusa's File Module as the storage boundary, with MinIO's S3-compatible API for local development and the same provider configuration for Cloudflare R2 or AWS S3 in production. PostgreSQL stores the resulting URLs and provider file IDs; Git never stores the image binaries.

### Import a Magic expansion

Import every printing from one Scryfall set into PostgreSQL by passing its set code. The command creates or updates the Magic game and set records, follows every Scryfall result page, and then creates or updates card printings by Scryfall ID. It stores the complete Scryfall set and card responses in JSON metadata while also filling the normalized catalogue fields.

The storefront reads the complete imported catalogue from `GET /store/tcg/cards`. The endpoint is paginated with `limit` and `offset`, returns every printing, and projects missing listings as zero-stock cards with no price. A listing is only exposed as sellable stock after it is linked to a Medusa variant.

Configure the local frontend with a Chilean CLP region and a publishable key after the database is running. The generated `.env.local` is ignored by Git:

```sh
STOREFRONT_ENV_PATH=../bannedCards/apps/storefront/.env.local pnpm storefront:configure
```

```sh
pnpm catalog:import-set LTR
```

`LTR` is the Scryfall code for The Lord of the Rings: Tales of Middle-earth. The common transposition `TLR` is accepted as an alias. The importer waits between Scryfall requests and is safe to run again to refresh the expansion. After importing, copy its images to object storage with `pnpm images:sync`.

Seed 50 randomly selected LTR printings as local test inventory. This creates linked Medusa products, variants, prices, inventory items, and inventory levels, then records the storefront quantity in `card_listing.quantity`. Each selected listing receives between one and five units:

```sh
pnpm catalog:seed-demo-stock
```

### Synchronize card images

Each `card_printing` must have `image_source=scryfall`, an `external_id`, and Scryfall `image_url` / `image_small_url` values. The synchronization command downloads only from `https://cards.scryfall.io`, rejects unsupported content types and files larger than 15 MB, uploads public objects through Medusa's File Module, and then updates:

- the printing's managed `image_url` and `image_small_url`;
- its original Scryfall URLs, storage IDs, storage URLs, and timestamp inside `attributes`;
- the `thumbnail` of every linked Medusa core product.

The storefront catalogue only publishes managed storage URLs (`image_storage_url` and `image_small_storage_url`); it never falls back to Scryfall. Unsynced cards show a placeholder until this command completes. Run `pnpm images:sync` after each set import.

The procedure is idempotent: records with both storage URLs are skipped, while linked product thumbnails are reconciled again. Preview the work first, then synchronize:

```sh
pnpm images:dry-run
pnpm images:sync
```

For local MinIO, configure the ignored `.env` and start the services. The setup generates a local password without printing it and is safe to run repeatedly:

```sh
pnpm storage:configure
pnpm infra:up
open http://localhost:9003
```

The MinIO console is on port `9003`, its S3 API and public card URLs use port `9002`, and the bucket is created automatically. For R2, keep `FILE_STORAGE_DRIVER=s3`, set `S3_REGION=auto`, use the R2 S3 endpoint and credentials, set `S3_FILE_URL` to the bucket's public custom domain, and set `S3_FORCE_PATH_STYLE=false`.

Run `pnpm test` to verify downloads, idempotency, source-host restrictions, and database update payloads without contacting Scryfall or object storage. Run `pnpm typecheck` and `docker compose --env-file .env.template config --quiet` for configuration validation.

API access does not itself grant commercial rights to the underlying card art, so confirm production use with Wizards' policies and your authorized distributor before launch. Preserve original card notices and attribution.

Never commit Mercado Pago access tokens, webhook secrets, database passwords, or production signing secrets. A Mercado Pago provider must create payment sessions server-side, verify webhook authenticity, handle duplicate events idempotently, and update Medusa payment state through its payment module. The browser must never decide that a payment succeeded.

## Set directory and hottest singles

Run `pnpm sets:sync` once to import all Scryfall set metadata and store SVG icons using the configured File Module. There is no scheduled job: press **Update list** in the CMS Sets section (or run `pnpm sets:sync`) to refresh set metadata and icons. Keep the existing S3/MinIO/R2 configuration and persistent storage enabled. New set metadata and icons appear without a frontend deployment. Missing icons use a frontend fallback and retry on the next sync. A failed upstream fetch preserves the previously saved directory. Set metadata sync does not import card printings or create stock.

- `GET /store/tcg/sets?limit=10&offset=0`: flat page of up to ten sets plus `offset`, `nextOffset`, `previousOffset`, and `latestSetCodes`.
- `q=<name-or-code>` searches all visible sets before pagination. Only `metadata.isVisible === true` is included; no parent/block visibility gating applies to this endpoint.
- `GET /store/tcg/hottest`: variant IDs ranked by paid units in orders created in the last 30 days, minus received returns, excluding canceled orders and scoped to the Store API key's sales channels. No customer or order details are exposed.

The storefront list has no block divisions. Sets sort newest first, with undated sets last. Next/previous controls replace the visible page rather than appending rows. Upcoming releases are labeled. No inventory counts are included. Latest releases uses the two newest released expansion/core/draft-innovation sets and their related products. The existing card importer preserves directory/icon metadata.
