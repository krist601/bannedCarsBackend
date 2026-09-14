# Banned Cards Postman collection

Import these two files into Postman:

- `Banned Cards - Medusa Store API.postman_collection.json`
- `Banned Cards Local.postman_environment.json`

Select **Banned Cards Local**, start the backend, and enter `admin_email` and `admin_password` as local current values. Do not export populated secrets.

Run **00 - Setup and health** first. It logs in to the local admin, discovers the publishable Store API key, and selects the CLP region. Then run **01 - Catalogue and discovery**. Cart tests need at least one sellable Medusa product so the collection can capture `product_id` and `variant_id`.

For registration, use a new `customer_email`. When repeating the workflow for an existing account, skip registration and run **Login customer**. Postman retains the Medusa session cookie after **Create session**.

Run cart requests sequentially. Promotion, shipping, payment, completion, return, and transfer requests need matching Medusa configuration and valid IDs. Mercado Pago is not connected yet, so payment and order completion cannot complete a real Mercado Pago transaction.

The Scryfall importer and MinIO image synchronizer are CLI jobs rather than HTTP endpoints:

```sh
pnpm catalog:import-set LTR
pnpm images:sync
```

The collection contains no database password, Mercado Pago secret, S3 secret, or admin password.

Regenerate the JSON files after editing [the generator](../scripts/generate-postman.mjs):

```sh
pnpm postman:generate
```
