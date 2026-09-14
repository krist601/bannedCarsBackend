import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260912234907 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "tcg_game" drop constraint if exists "tcg_game_handle_unique";`);
    this.addSql(`alter table if exists "catalog_product" drop constraint if exists "catalog_product_handle_unique";`);
    this.addSql(`alter table if exists "catalog_listing" drop constraint if exists "catalog_listing_sku_unique";`);
    this.addSql(`alter table if exists "card_listing" drop constraint if exists "card_listing_sku_unique";`);
    this.addSql(`create table if not exists "card_listing" ("id" text not null, "printing_id" text not null, "product_id" text null, "variant_id" text null, "sku" text not null, "condition" text check ("condition" in ('near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged')) not null, "language" text not null default 'English', "finish" text check ("finish" in ('non_foil', 'foil', 'etched', 'other')) not null default 'non_foil', "price_clp" integer not null, "quantity" integer not null default 0, "storage_location" text null, "photos" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "card_listing_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_listing_printing_id" ON "card_listing" ("printing_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_listing_product_id" ON "card_listing" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_listing_variant_id" ON "card_listing" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_card_listing_sku_unique" ON "card_listing" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_listing_deleted_at" ON "card_listing" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "card_printing" ("id" text not null, "game_id" text not null, "set_id" text not null, "collector_number" text not null, "name" text not null, "rarity" text null, "external_id" text null, "image_source" text null, "image_url" text null, "image_small_url" text null, "attributes" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "card_printing_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_printing_game_id" ON "card_printing" ("game_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_printing_set_id" ON "card_printing" ("set_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_printing_name" ON "card_printing" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_printing_external_id" ON "card_printing" ("external_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_card_printing_deleted_at" ON "card_printing" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "catalog_listing" ("id" text not null, "catalog_product_id" text not null, "product_id" text null, "variant_id" text null, "sku" text not null, "condition" text null, "language" text null, "finish" text null, "price_clp" integer not null, "quantity" integer not null default 0, "photos" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_listing_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_listing_catalog_product_id" ON "catalog_listing" ("catalog_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_listing_product_id" ON "catalog_listing" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_listing_variant_id" ON "catalog_listing" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_listing_sku_unique" ON "catalog_listing" ("sku") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_listing_deleted_at" ON "catalog_listing" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "catalog_product" ("id" text not null, "game_id" text null, "kind" text check ("kind" in ('single', 'sealed', 'accessory')) not null, "title" text not null, "handle" text not null, "description" text null, "attributes" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_product_game_id" ON "catalog_product" ("game_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_product_title" ON "catalog_product" ("title") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_product_handle_unique" ON "catalog_product" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_catalog_product_deleted_at" ON "catalog_product" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tcg_game" ("id" text not null, "handle" text not null, "name" text not null, "publisher" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tcg_game_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tcg_game_handle_unique" ON "tcg_game" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tcg_game_deleted_at" ON "tcg_game" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tcg_set" ("id" text not null, "game_id" text not null, "code" text not null, "name" text not null, "released_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tcg_set_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tcg_set_game_id" ON "tcg_set" ("game_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tcg_set_deleted_at" ON "tcg_set" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "card_listing" cascade;`);

    this.addSql(`drop table if exists "card_printing" cascade;`);

    this.addSql(`drop table if exists "catalog_listing" cascade;`);

    this.addSql(`drop table if exists "catalog_product" cascade;`);

    this.addSql(`drop table if exists "tcg_game" cascade;`);

    this.addSql(`drop table if exists "tcg_set" cascade;`);
  }

}
