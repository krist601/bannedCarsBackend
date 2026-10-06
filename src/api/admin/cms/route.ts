import {getStorefrontSettings,saveStorefrontSettings} from "../../../lib/storefront-settings";
import { cmsUsers } from "../../../lib/cms-users";
import { cmsBackups } from "../../../lib/cms-backups";
import { cmsStores, allowedStockChannels, productStoreChannels } from "../../../lib/cms-stores";
import { previewSetPrices } from "../../../lib/cms-set-prices";
import { basePrice } from "../../../lib/cms-base-prices";
import { readPricing, pricingSettings } from "../../../lib/cms-pricing-settings";
import { sealedFinder } from "../../../lib/cms-sealed-finder";
import { getSealed, postSealed } from "../../../lib/cms-sealed";
import { visibleFilterSets } from "../../../lib/cms-visible-sets";
import {
  compareCardsBySet,
  compareSetsNewest,
  readAllCmsRows,
} from "../../../lib/cms-catalog-sort";
import {
  parseStockImport,
  normalizeImportName,
} from "../../../lib/cms-stock-import";
import { groupCmsSets } from "../../../lib/cms-set-groups";
import { randomUUID } from "node:crypto";
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  deleteProductsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";
import type Catalog from "../../../modules/tcg-catalog/service";
import importSet from "../../../scripts/import-scryfall-set";
import { positiveInteger } from "../../../lib/cms-access";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  stockLanguage,
  optionalCardSku,
} from "../../../lib/cms-stock";

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const catalog: Catalog = req.scope.resolve("tcgCatalog");
  const resource = String(req.query.resource || "overview");
  if(resource === "backups") return cmsBackups(req,res);
  if(resource === "pricing") return pricingSettings(req,res);
  if (resource === "stores") return cmsStores(req, res);
  if (resource === "users") return cmsUsers(req, res);
  const skip = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(skip) || skip < 0) {
    res.status(400).json({ message: "Invalid offset" });
    return;
  }
  const config = { take: 30, skip, order: { created_at: "DESC" as const } };
  if (resource === "storefront_settings") return getStorefrontSettings(req,res);
  if (resource === "sealed") return getSealed(req, res);
  if (resource === "me") {
    const user = await req.scope
      .resolve(Modules.USER)
      .retrieveUser(req.auth_context.actor_id);
    res.json({ user: { email: user.email, isAdmin: user.metadata?.isAdmin === true } });
    return;
  }
  if (resource === "sets") {
    // Group the full directory before pagination so a family is never split across pages.
    const sets: Parameters<typeof groupCmsSets>[0] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await catalog.listCardSets(
        {},
        { skip: offset, take: 500, order: { id: "ASC" } },
      );
      sets.push(...page);
      if (page.length < 500) break;
    }
    const groups = groupCmsSets(sets);
    res.json({ rows: groups.slice(skip, skip + 30), count: groups.length });
    return;
  }
  if (resource === "set_options") {
    const sets = await readAllCmsRows((offset) =>
      catalog.listAndCountCardSets(
        {},
        { take: 500, skip: offset, order: { id: "ASC" } },
      ),
    );
    res.json({
      rows: visibleFilterSets(sets)
        .sort(compareSetsNewest)
        .map(({ id, name, code, released_at }) => ({
          id,
          name,
          code,
          released_at,
        })),
    });
    return;
  }
  if (resource === "cards") {
    const filters: Record<string, unknown> = {};
    if (req.query.q)
      filters.name = { $ilike: `%${String(req.query.q).slice(0, 100)}%` };
    if (req.query.set_id) filters.set_id = String(req.query.set_id);
    const matching = await readAllCmsRows((offset) =>
      catalog.listAndCountCardPrintings(filters, {
        take: 500,
        skip: offset,
        order: { id: "ASC" },
      }),
    );
    const sets = await readAllCmsRows((offset) =>
      catalog.listAndCountCardSets(
        {},
        { take: 500, skip: offset, order: { id: "ASC" } },
      ),
    );
    const setById = new Map(sets.map((set) => [set.id, set]));
    matching.sort((a, b) => compareCardsBySet(a, b, setById));
    const count = matching.length;
    const rows = matching.slice(skip, skip + 30);
    res.json({
      rows: rows.map((row) => ({
        ...row,
        card_sku: row.attributes?.cms_sku ?? null,
        set_code: setById.get(row.set_id)?.code ?? null,
        set_name: setById.get(row.set_id)?.name ?? null,
      })),
      count,
    });
    return;
  }
  if (resource === "locations") {
    const rows = await req.scope
      .resolve(Modules.STOCK_LOCATION)
      .listStockLocations({}, { take: 100 });
    res.json({ rows });
    return;
  }
  if (resource === "stock") {
    const printings = await readAllCmsRows((offset) =>
      catalog.listAndCountCardPrintings(
        {
          ...(req.query.set_id ? { set_id: String(req.query.set_id) } : {}),
          ...(req.query.printing_id
            ? { id: String(req.query.printing_id) }
            : {}),
        },
        { take: 500, skip: offset, order: { id: "ASC" } },
      ),
    );
    const printingById = new Map(printings.map((p) => [p.id, p]));
    if (!printings.length) {
      res.json({ rows: [], count: 0 });
      return;
    }
    const matching = await readAllCmsRows((offset) =>
      catalog.listAndCountCardListings(
        {
          ...(req.query.q
            ? { sku: { $ilike: `%${String(req.query.q).slice(0, 100)}%` } }
            : {}),
          printing_id: printings.map((p) => p.id),
        },
        { take: 500, skip: offset, order: { id: "ASC" } },
      ),
    );
    const sets = await readAllCmsRows((offset) =>
      catalog.listAndCountCardSets(
        {},
        { take: 500, skip: offset, order: { id: "ASC" } },
      ),
    );
    const setById = new Map(sets.map((set) => [set.id, set]));
    matching.sort((a, b) =>
      compareCardsBySet(
        { ...printingById.get(a.printing_id)!, id: a.id },
        { ...printingById.get(b.printing_id)!, id: b.id },
        setById,
      ),
    );
    const locationId = typeof req.query.location_id === "string" ? req.query.location_id : "";
    const rows = locationId ? matching : matching.slice(skip, skip + 30);
    const inventory = req.scope.resolve(Modules.INVENTORY);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const printing = printingById.get(row.printing_id)!;
        const set = await catalog.retrieveCardSet(printing.set_id);
        const { data } = row.variant_id
          ? await query.graph({
              entity: "product_variant",
              fields: ["id", "inventory_items.inventory_item_id"],
              filters: { id: row.variant_id },
            })
          : { data: [] };
        const item = data[0]?.inventory_items?.[0]?.inventory_item_id;
        const levels = item
          ? await inventory.listInventoryLevels(
              { inventory_item_id: item, ...(locationId ? { location_id: locationId } : {}) },
              { take: 100 },
            )
          : [];
        return {
          ...row,
          set_id: printing.set_id,
          name: printing.name,
          collector_number: printing.collector_number,
          set_code: set.code,
          set_name: set.name,
          levels,
        };
      }),
    );
    const visible = locationId ? enriched.filter(row => row.levels.some(level => Number(level.available_quantity) > 0 || Number(level.reserved_quantity) > 0)) : enriched;
    res.json({ rows: locationId ? visible.slice(skip, skip + 30) : visible, count: locationId ? visible.length : matching.length });
    return;
  }
  if (resource === "orders") {
    const closed = req.query.status === "closed";
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data, metadata } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "status",
        "created_at",
        "currency_code",
        "total",
        "items.*",
        "shipping_address.*",
      ],
      filters: {
        status: closed
          ? ["completed", "canceled", "archived"]
          : ["pending", "requires_action"],
      },
      pagination: config,
    });
    res.json({ rows: data, count: metadata?.count || 0 });
    return;
  }
  if (resource === "overview") {
    const [, cards] = await catalog.listAndCountCardPrintings({}, { take: 1 });
    const [, sets] = await catalog.listAndCountCardSets({}, { take: 1 });
    const [, listings] = await catalog.listAndCountCardListings(
      {},
      { take: 1 },
    );
    const { metadata: orderMetadata } = await req.scope
      .resolve(ContainerRegistrationKeys.QUERY)
      .graph({
        entity: "order",
        fields: ["id"],
        filters: { status: ["pending", "requires_action"] },
        pagination: { take: 1, skip: 0 },
      });
    const openOrders = orderMetadata?.count || 0;
    res.json({ cards, sets, listings, openOrders });
    return;
  }
  res.status(404).json({ message: "Unknown resource" });
}

export async function POST(
  req: AuthenticatedMedusaRequest<Record<string, unknown>>,
  res: MedusaResponse,
) {
  if(["backup_create","backup_restore","backup_resume"].includes(String(req.body?.action || ""))) return cmsBackups(req,res);
  if(req.body?.action === "pricing_settings") return pricingSettings(req,res);
  if (req.body?.action === "set_prices") return previewSetPrices(req,res);
  if (["store_save","warehouse_create"].includes(String(req.body?.action))) return cmsStores(req,res);
  if (req.body?.action === "storefront_settings") return saveStorefrontSettings(req,res,req.body);
  if (["user_save", "user_create"].includes(String(req.body?.action))) return cmsUsers(req,res);
  return handleAction(req, res, req.body);
}

async function handleAction(
  req: AuthenticatedMedusaRequest<Record<string, unknown>>,
  res: MedusaResponse,
  body: Record<string, unknown>,
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ message: "Expected a JSON object" });
    return;
  }
  const catalog: Catalog = req.scope.resolve("tcgCatalog");
  if (["sealed_find", "sealed_accept", "sealed_graphics", "sealed_banner"].includes(String(body.action)))
    return sealedFinder(req, res, body);
  if (String(body.action).startsWith("sealed_"))
    return postSealed(req, res, body);
  if (
    body.action === "stock_import_preview" ||
    body.action === "stock_import"
  ) {
    let rows;
    try {
      rows = parseStockImport(body.text);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
      return;
    }
    if (
      !CARD_CONDITIONS.includes(String(body.condition)) ||
      typeof body.location_id !== "string" ||
      !body.location_id
    ) {
      res.status(400).json({ message: "Select a condition and warehouse." });
      return;
    }
    await req.scope
      .resolve(Modules.STOCK_LOCATION)
      .retrieveStockLocation(body.location_id);
    for (const row of rows) {
      if (row.error) continue;
      const sets = await catalog.listCardSets({ code: row.code }, { take: 2 });
      if (sets.length !== 1) {
        row.error = "Set code not found in catalog. Import the set first.";
        continue;
      }
      const [printings] = await catalog.listAndCountCardPrintings(
        { set_id: sets[0].id, collector_number: row.collector },
        { take: 100 },
      );
      const matches = printings.filter(
        (p) => normalizeImportName(p.name) === normalizeImportName(row.name),
      );
      // Collector numbers are unique within a set. Keep accepting a unique
      // collector match when a pasted name has a typo or uses a different
      // apostrophe/split-name spelling; the preview shows the catalog name.
      const resolved = matches.length === 1 ? matches : printings.length === 1 ? printings : [];
      if (resolved.length !== 1) {
        row.error =
          "Card name and collector number must match exactly one printing in this set.";
        continue;
      }
      row.printing_id = resolved[0].id;
      if (matches.length !== 1) row.warning = `Catalog name: ${resolved[0].name}`;
    }
    if (
      body.action === "stock_import_preview" ||
      rows.some((row) => row.error)
    ) {
      res.json({
        rows,
        valid: rows.every((row) => !row.error),
        applied: false,
      });
      return;
    }
    const results = [];
    // Stop on the first failure: completed rows remain received and must not be repeated.
    for (const row of rows) {
      let code = 200;
      let result: Record<string, unknown> = {};
      const reply = {
        status(value: number) {
          code = value;
          return this;
        },
        json(value: Record<string, unknown>) {
          result = value;
          return this;
        },
      };
      try {
        await handleAction(req, reply as unknown as MedusaResponse, {
          action: "quick_add",
          printing_id: row.printing_id,
          quantity: row.quantity,
          condition: body.condition,
          location_id: body.location_id,
          finish: row.finish,
          language: row.language,
        });
      } catch (error) {
        code = 500;
        result = { message: (error as Error).message };
      }
      results.push({
        ...row,
        ok: code < 400 && result.ok === true,
        message: result.message,
        warning: result.warning,
      });
      if (code >= 400 || result.ok !== true || result.warning) break;
    }
    res.json({
      rows: results,
      applied: true,
      completed:
        results.length === rows.length && results.every((row) => row.ok),
      total: rows.length,
    });
    return;
  }
  if (body.action === "set_visibility") {
    if (
      typeof body.set_id !== "string" ||
      typeof body.isVisible !== "boolean"
    ) {
      res
        .status(400)
        .json({ message: "Set and boolean isVisible are required." });
      return;
    }
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-set:${body.set_id}`, async () => {
        const set = await catalog.retrieveCardSet(body.set_id as string);
        await catalog.updateCardSets({
          id: set.id,
          metadata: { ...set.metadata, isVisible: body.isVisible },
        });
        res.json({ ok: true, isVisible: body.isVisible });
      });
    return;
  }
  if (body.action === "card_sku") {
    let sku: string | null;
    try {
      sku = optionalCardSku(body.sku);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
      return;
    }
    if (typeof body.printing_id !== "string") {
      res.status(400).json({ message: "Card is required" });
      return;
    }
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-printing:${body.printing_id}`, async () => {
        const printing = await catalog.retrieveCardPrinting(
          body.printing_id as string,
        );
        await catalog.updateCardPrintings({
          id: printing.id,
          attributes: { ...printing.attributes, cms_sku: sku },
        });
        res.json({ ok: true, card_sku: sku });
      });
    return;
  }
  if (body.action === "quick_add") {
    let language: string;
    let quantity: number;
    try {
      quantity = positiveInteger(body.quantity ?? 1, "Quantity", 10000);
      language = stockLanguage(body.language);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
      return;
    }
    if (
      typeof body.printing_id !== "string" ||
      typeof body.location_id !== "string" ||
      !CARD_CONDITIONS.includes(String(body.condition)) ||
      !CARD_FINISHES.includes(String(body.finish))
    ) {
      res
        .status(400)
        .json({ message: "Select a card, condition, finish, and warehouse" });
      return;
    }
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-printing:${body.printing_id}`, async () => {
        const listings = await catalog.listCardListings(
          {
            printing_id: body.printing_id,
            condition: body.condition,
            finish: body.finish,
          },
          { take: 1000 },
        );
        const matches = listings.filter(
          (l) =>
            stockLanguage(l.language).toLowerCase() === language.toLowerCase(),
        );
        if (matches.length > 1) {
          res.status(409).json({
            message:
              "Multiple listings match this condition and language. Use the controls on the specific listing.",
          });
          return;
        }
        if (matches[0]) {
          await handleAction(req, res, {
            action: "receive",
            listing_id: matches[0].id,
            location_id: body.location_id,
            quantity,
          });
        } else {
          await handleAction(req, res, {
            action: "listing",
            printing_id: body.printing_id,
            condition: body.condition,
            finish: body.finish,
            language,
            location_id: body.location_id,
            quantity,
            price_clp: null,
          });
        }
      });
    return;
  }
  if (body.action === "price") {
    let price: number;
    try {
      price = positiveInteger(body.price_clp, "Price", 100000000);
      const settings = await readPricing(req.scope);
      if(price < settings.minimum) throw new Error(`Minimum card price is CLP ${settings.minimum}.`);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
      return;
    }
    if (typeof body.listing_id !== "string") {
      res.status(400).json({ message: "Listing is required" });
      return;
    }
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-price:${body.listing_id}`, async () => {
        const listing = await catalog.retrieveCardListing(
          body.listing_id as string,
        );
        if (!listing.variant_id || !listing.product_id) {
          res
            .status(409)
            .json({ message: "Listing is not linked to a commerce product" });
          return;
        }
        await updateProductVariantsWorkflow(req.scope).run({
          input: {
            product_variants: [
              {
                id: listing.variant_id,
                prices: [{ currency_code: "clp", amount: price }],
              },
            ],
          },
        });
        if (listing.metadata?.price_pending === true) {
          await updateProductsWorkflow(req.scope).run({
            input: {
              products: [
                { id: listing.product_id, status: ProductStatus.PUBLISHED },
              ],
            },
          });
        }
        await catalog.updateCardListings({
          id: listing.id,
          price_clp: price,
          metadata: { ...listing.metadata, price_pending: false, price_source: "custom" },
        });
        res.json({ ok: true });
      });
    return;
  }
  if (body.action === "import") {
    const codes = body.codes;
    if (
      !Array.isArray(codes) ||
      !codes.length ||
      codes.length > 10 ||
      codes.some((c) => typeof c !== "string" || !/^[a-zA-Z0-9]{2,8}$/.test(c))
    ) {
      res.status(400).json({ message: "Provide 1–10 valid set codes." });
      return;
    }
    const results = [];
    for (const code of [...new Set(codes)]) {
      try {
        await importSet({ container: req.scope, args: [code] } as Parameters<
          typeof importSet
        >[0]);
        results.push({ code, ok: true });
      } catch (error) {
        results.push({
          code,
          ok: false,
          message: error instanceof Error ? error.message : "Import failed",
        });
      }
    }
    res.json({ results });
    return;
  }
  if (body.action === "receive" || body.action === "subtract") {
    const subtract = body.action === "subtract";
    let quantity: number;
    try {
      quantity = positiveInteger(body.quantity, "Quantity");
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
      return;
    }
    const inventory = req.scope.resolve(Modules.INVENTORY);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    if (
      typeof body.listing_id !== "string" ||
      typeof body.location_id !== "string"
    ) {
      res.status(400).json({ message: "Listing and warehouse are required" });
      return;
    }
    const listing = await catalog.retrieveCardListing(body.listing_id);
    if (!listing.variant_id) {
      res
        .status(409)
        .json({ message: "Listing has no linked commerce variant" });
      return;
    }
    await req.scope
      .resolve(Modules.STOCK_LOCATION)
      .retrieveStockLocation(body.location_id);
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "inventory_items.inventory_item_id",
        "product.sales_channels.id",
      ],
      filters: { id: listing.variant_id },
    });
    const item = data[0]?.inventory_items?.[0]?.inventory_item_id;
    if (!item) {
      res.status(409).json({ message: "Listing has no linked inventory item" });
      return;
    }
    const channels =
      data[0]?.product?.sales_channels?.map(
        (channel: { id: string }) => channel.id,
      ) || [];
    if (!subtract && channels.length)
      await linkSalesChannelsToStockLocationWorkflow(req.scope).run({
        input: { id: body.location_id, add: await allowedStockChannels(req.scope,body.location_id,channels), remove: [] },
      });
    const locationId = body.location_id;
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-inventory:${item}`, async () => {
        const levels = await inventory.listInventoryLevels({
          inventory_item_id: item,
          location_id: locationId,
        });
        if (
          subtract &&
          (!levels.length || Number(levels[0].available_quantity) < quantity)
        ) {
          res.status(409).json({
            message: `Only ${Math.max(0, Number(levels[0]?.available_quantity ?? 0))} unreserved units are available at this warehouse. Refresh stock and try again.`,
          });
          return;
        }
        if (!levels.length) {
          await createInventoryLevelsWorkflow(req.scope).run({
            input: {
              inventory_levels: [
                {
                  inventory_item_id: item,
                  location_id: locationId,
                  stocked_quantity: quantity,
                },
              ],
            },
          });
        } else {
          await inventory.adjustInventory(
            item,
            locationId,
            subtract ? -quantity : quantity,
          );
        }
        // A successful stock mutation must not look failed if the legacy snapshot refresh fails.
        try {
          const all = await inventory.listInventoryLevels(
            { inventory_item_id: item },
            { take: 1000 },
          );
          await catalog.updateCardListings({
            id: listing.id,
            quantity: all.reduce(
              (sum, level) =>
                sum + Math.max(0, Number(level.available_quantity)),
              0,
            ),
            metadata: {
              ...listing.metadata,
              last_stock_adjustment_at: new Date().toISOString(),
              last_stock_adjustment_by: req.auth_context.actor_id,
              last_stock_adjustment_quantity: subtract ? -quantity : quantity,
              last_stock_adjustment_location: locationId,
            },
          });
        } catch {
          res.json({
            ok: true,
            warning:
              "Stock was updated in Medusa, but the storefront quantity snapshot could not be refreshed. Do not repeat this adjustment.",
          });
          return;
        }
        res.json({ ok: true });
      });
    return;
  }
  if (body.action === "listing") {
    let quantity: number, price: number;
    try {
      quantity = positiveInteger(body.quantity, "Quantity");
      price =
        body.price_clp === null || body.price_clp === undefined
          ? 0
          : positiveInteger(body.price_clp, "Price", 100000000);
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
      return;
    }
    const conditions = [
      "near_mint",
      "lightly_played",
      "moderately_played",
      "heavily_played",
      "damaged",
    ];
    const finishes = ["non_foil", "foil", "etched", "other"];
    if (
      typeof body.printing_id !== "string" ||
      typeof body.location_id !== "string" ||
      !conditions.includes(String(body.condition)) ||
      !finishes.includes(String(body.finish)) ||
      typeof body.language !== "string" ||
      !body.language.trim() ||
      body.language.length > 60
    ) {
      res
        .status(400)
        .json({ message: "Complete all listing fields with valid values" });
      return;
    }
    const internalSku = `BC-${randomUUID()}`;
    const printing = await catalog.retrieveCardPrinting(body.printing_id);
    const customPrice = body.price_clp !== null && body.price_clp !== undefined;
    const pricing = await readPricing(req.scope);
    if (!customPrice) price = basePrice(printing, String(body.finish),pricing) ?? 0;
    else if(price < pricing.minimum){res.status(400).json({message:`Minimum card price is CLP ${pricing.minimum}.`});return;}
    await req.scope
      .resolve(Modules.STOCK_LOCATION)
      .retrieveStockLocation(body.location_id);
    const [channel] = await req.scope
      .resolve(Modules.SALES_CHANNEL)
      .listSalesChannels({}, { take: 1 });
    const [profile] = await req.scope
      .resolve(Modules.FULFILLMENT)
      .listShippingProfiles({}, { take: 1 });
    if (!channel || !profile) {
      res.status(409).json({
        message:
          "Configure a sales channel and shipping profile in Medusa first.",
      });
      return;
    }
    await linkSalesChannelsToStockLocationWorkflow(req.scope).run({
      input: { id: body.location_id, add: await allowedStockChannels(req.scope,body.location_id,[channel.id]), remove: [] },
    });
    const { result: products } = await createProductsWorkflow(req.scope).run({
      input: {
        products: [
          {
            title: printing.name,
            // Each condition/language/finish listing owns a separate Medusa product.
            // A name-derived handle collides as soon as the second listing is added.
            handle: internalSku.toLowerCase(),
            status: price > 0 ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
            shipping_profile_id: profile.id,
            sales_channels: await productStoreChannels(req.scope,channel.id),
            thumbnail: printing.image_url || undefined,
            metadata: { printing_id: printing.id, kind: "single" },
            options: [{ title: "Card", values: ["Default"] }],
            variants: [
              {
                title: `${body.condition} / ${body.language} / ${body.finish}`,
                sku: internalSku,
                manage_inventory: true,
                allow_backorder: false,
                options: { Card: "Default" },
                prices:
                  price > 0 ? [{ currency_code: "clp", amount: price }] : [],
              },
            ],
          },
        ],
      },
    });
    const product = products[0];
    try {
      const variant = product.variants![0];
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory_item_id"],
        filters: { id: variant.id },
      });
      const item = data[0]?.inventory_items?.[0]?.inventory_item_id;
      if (!item) throw new Error("No inventory item created");
      await createInventoryLevelsWorkflow(req.scope).run({
        input: {
          inventory_levels: [
            {
              inventory_item_id: item,
              location_id: body.location_id,
              stocked_quantity: quantity,
            },
          ],
        },
      });
      await catalog.createCardListings({
        printing_id: printing.id,
        product_id: product.id,
        variant_id: variant.id,
        sku: internalSku,
        condition: body.condition as "near_mint",
        finish: body.finish as "foil",
        language: body.language,
        quantity,
        price_clp: price,
        storage_location: body.location_id,
        metadata: {
          received_by: req.auth_context.actor_id,
          price_pending: price === 0,
          price_source: customPrice ? "custom" : "scryfall",
        },
      });
    } catch (error) {
      await deleteProductsWorkflow(req.scope).run({
        input: { ids: [product.id] },
      });
      throw error;
    }
    res.status(201).json({ ok: true });
    return;
  }
  res.status(400).json({ message: "Unknown action" });
}
