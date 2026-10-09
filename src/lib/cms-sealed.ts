import { randomUUID } from "node:crypto";
import { allowedStockChannels, productStoreChannels } from "./cms-stores";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
  createInventoryLevelsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

/** Product sections managed with the same CMS screen. `sealed` keeps its legacy handles and metadata. */
export const SHOP_SECTIONS = {
  sealed: { root: "sealed-products", name: "Sealed products", kind: "sealed", skuPrefix: "SEALED", groups: [] as string[][] },
  custom: {
    root: "custom-products", name: "Custom products", kind: "custom", skuPrefix: "CUSTOM",
    groups: [["custom-token-packs", "Token packs"], ["custom-decks", "Custom decks"], ["custom-other", "Other"]],
  },
  accessories: {
    root: "accessories", name: "Accessories", kind: "accessory", skuPrefix: "ACC",
    groups: [["accessories-sleeves", "Sleeves"], ["accessories-dice", "Dice"], ["accessories-playmats", "Playmats"], ["accessories-deck-boxes", "Deck boxes"], ["accessories-other", "Other"]],
  },
} as const;
export type ShopSectionKey = keyof typeof SHOP_SECTIONS;
export function shopSection(value: unknown) {
  const key = (value === undefined || value === "" ? "sealed" : String(value)) as ShopSectionKey;
  if (!(key in SHOP_SECTIONS)) throw new Error("Unknown product section.");
  return { key, ...SHOP_SECTIONS[key] };
}
/** Creates the section's root category and default groups the first time they are needed. */
async function ensureSection(scope: any, section: ReturnType<typeof shopSection>) {
  if (section.key === "sealed") return;
  const service = scope.resolve(Modules.PRODUCT);
  await scope.resolve(Modules.LOCKING).execute(`cms-section:${section.key}`, async () => {
    let [root] = await service.listProductCategories({ handle: section.root });
    if (!root) root = await service.createProductCategories({ handle: section.root, name: section.name, is_active: true, is_internal: false });
    for (const [handle, name] of section.groups) {
      const [existing] = await service.listProductCategories({ handle });
      if (!existing) await service.createProductCategories({ handle, name, parent_category_id: root.id, is_active: true, is_internal: false });
    }
  });
}
export function sealedCategoryIds(categories: any[], rootHandle = "sealed-products") {
  const root = categories.find((c) => c.handle === rootHandle);
  const ids = new Set<string>();
  if (!root) return ids;
  ids.add(root.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories)
      if (ids.has(c.parent_category_id) && !ids.has(c.id)) {
        ids.add(c.id);
        changed = true;
      }
  }
  return ids;
}
export async function directory(scope: any, section = shopSection("sealed")) {
  await ensureSection(scope, section);
  const service = scope.resolve(Modules.PRODUCT);
  const categories: any[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = await service.listProductCategories(
      {},
      { take: 100, skip, order: { id: "ASC" } },
    );
    categories.push(...page);
    if (page.length < 100) break;
  }
  const ids = sealedCategoryIds(categories, section.root);
  return { service, categories: categories.filter((c) => ids.has(c.id)), ids, section };
}
export function sealedInput(body: any) {
  const title = String(body.title || "").trim();
  if (!title || title.length > 200)
    throw new Error("Product name must contain 1–200 characters.");
  if (!["draft", "published"].includes(body.status))
    throw new Error("Select Draft or Published.");
  const text = (key: string, max = 200) => {
    const value = String(body[key] ?? "").trim();
    if (value.length > max) throw new Error(`${key} is too long`);
    return value;
  };
  const thumbnail = text("thumbnail", 2000);
  if (
    thumbnail &&
    !/^https?:\/\//i.test(thumbnail) &&
    !/^\/(?!\/)/.test(thumbnail)
  )
    throw new Error("Use an HTTP(S) image URL or a local image path.");
  return {
    title,
    status: body.status,
    description: text("description", 5000),
    thumbnail: thumbnail || null,
    set: text("set"),
    set_code: text("set_code", 20).toLowerCase(),
    language: text("language", 60) || "English",
  };
}
function price(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000000)
    throw new Error("Price must be a positive whole CLP amount.");
  return n;
}
async function product(scope: any, id: string, ids: Set<string>) {
  const p = await scope
    .resolve(Modules.PRODUCT)
    .retrieveProduct(id, { relations: ["categories", "variants"] });
  if (!(p.categories || []).some((c: any) => ids.has(c.id)))
    throw new Error("This product is not in this section.");
  return p;
}
async function variant(scope: any, id: string) {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "title",
      "metadata",
      "manage_inventory",
      "price_set.prices.*",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
    ],
    filters: { id },
  });
  if (!data[0]) throw new Error("Variant not found");
  return data[0];
}
export async function getSealed(req: any, res: any) {
  let section;
  try { section = shopSection(req.query.section); } catch (error) { res.status(400).json({ message: (error as Error).message }); return; }
  const { service, categories, ids } = await directory(req.scope, section);
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ message: "Invalid offset" });
    return;
  }
  const category = String(req.query.category_id || "");
  if (category && !ids.has(category)) {
    res.status(400).json({ message: "Invalid sealed group" });
    return;
  }
  if (!ids.size) {
    res.json({ rows: [], count: 0, categories });
    return;
  }
  const [products, count] = await service.listAndCountProducts(
    {
      categories: { id: category ? [category] : [...ids] },
      ...(req.query.q
        ? { title: { $ilike: `%${String(req.query.q).slice(0, 100)}%` } }
        : {}),
    },
    {
      take: 20,
      skip: offset,
      order: { created_at: "DESC" },
      relations: ["categories", "variants"],
    },
  );
  const rows = await Promise.all(
    products.map(async (p: any) => ({
      ...p,
      variants: await Promise.all(
        (p.variants || []).map(async (v: any) => {
          const detail = await variant(req.scope, v.id);
          const links = detail.inventory_items || [];
          const item =
            links.length === 1 && Number(links[0].required_quantity ?? 1) === 1
              ? links[0].inventory_item_id
              : null;
          const levels = item
            ? await req.scope
                .resolve(Modules.INVENTORY)
                .listInventoryLevels({ inventory_item_id: item }, { take: 100 })
            : [];
          return {
            ...v,
            price_clp:
              detail.price_set?.prices?.find(
                (p: any) =>
                  p.currency_code === "clp" &&
                  !p.price_list_id &&
                  !p.min_quantity &&
                  !p.max_quantity,
              )?.amount ?? null,
            levels,
            stock_editable: Boolean(item && detail.manage_inventory),
          };
        }),
      ),
    })),
  );
  res.json({ rows, count, categories });
}
export async function postSealed(req: any, res: any, body: any) {
  try {
  const { categories, ids, section } = await directory(req.scope, shopSection(body.section));
    if (body.action === "sealed_create") {
      const input = sealedInput(body);
      const amount = price(body.price_clp);
      if (!ids.has(body.category_id)) throw new Error("Select a group.");
      const [channel] = await req.scope
        .resolve(Modules.SALES_CHANNEL)
        .listSalesChannels({}, { take: 1 });
      const [profile] = await req.scope
        .resolve(Modules.FULFILLMENT)
        .listShippingProfiles({}, { take: 1 });
      if (!channel || !profile)
        throw new Error(
          "Configure a sales channel and shipping profile first.",
        );
      const root = categories.find((c) => c.handle === section.root);
      const { set, set_code, language, ...fields } = input;
      const sealed = section.key === "sealed";
      await createProductsWorkflow(req.scope).run({
        input: {
          products: [
            {
              ...fields,
              handle: `${section.key}-${randomUUID()}`,
              shipping_profile_id: profile.id,
              sales_channels: await productStoreChannels(req.scope,channel.id),
              category_ids: [...new Set([root.id, body.category_id])],
              metadata: sealed
                ? {
                    kind: "sealed",
                    game: "magic-the-gathering",
                    set,
                    set_code,
                    language,
                    finish: "Sealed",
                    condition: "Factory sealed",
                  }
                : { kind: section.kind, section: section.key },
              options: [{ title: sealed ? "Language" : "Type", values: [sealed ? language : "Standard"] }],
              variants: [
                {
                  title: sealed ? language : "Standard",
                  sku:
                    String(body.sku || "").trim() || `${section.skuPrefix}-${randomUUID()}`,
                  manage_inventory: true,
                  allow_backorder: false,
                  options: sealed ? { Language: language } : { Type: "Standard" },
                  metadata: sealed ? { language } : {},
                  prices: [{ currency_code: "clp", amount }],
                },
              ],
            },
          ],
        },
      });
      res.status(201).json({ ok: true });
      return;
    }
    if (body.action === "sealed_image") {
      const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
      const extension = types[String(body.mime_type)];
      const content = String(body.content || "");
      if (!extension) throw new Error("Use a PNG, JPEG or WebP image.");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw new Error("The image could not be read.");
      const bytes = Buffer.from(content, "base64");
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("The image must be 5 MB or smaller.");
      const signatures: Record<string, boolean> = {
        png: bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        jpg: bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
        webp: bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
      };
      if (!signatures[extension]) throw new Error("The file is not a valid image.");
      const file = await req.scope.resolve(Modules.FILE).createFiles({
        filename: `products/${section.key}/${randomUUID()}.${extension}`,
        mimeType: String(body.mime_type), content, access: "public",
      });
      res.json({ ok: true, url: file.url });
      return;
    }
    if (typeof body.product_id !== "string")
      throw new Error("Select a product.");
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-sealed:${body.product_id}`, async () => {
        const p = await product(req.scope, body.product_id, ids);
        if (body.action === "sealed_status") {
          if (!["draft", "published"].includes(body.status))
            throw new Error("Invalid status");
          if (body.status === "published") {
            for (const item of p.variants || []) {
              const v = await variant(req.scope, item.id);
              if (
                !(v.price_set?.prices || []).some(
                  (x: any) =>
                    x.currency_code === "clp" &&
                    !x.price_list_id &&
                    Number(x.amount) > 0,
                )
              )
                throw new Error("Set a positive CLP price before publishing.");
            }
            if (!p.variants?.length)
              throw new Error("Add a variant before publishing.");
          }
          await updateProductsWorkflow(req.scope).run({
            input: { products: [{ id: p.id, status: body.status }] },
          });
        } else if (body.action === "sealed_save") {
          const { set, set_code, language, ...fields } = sealedInput(body);
          if (fields.status === "published") {
            if (!p.variants?.length)
              throw new Error("Add a variant before publishing.");
            for (const item of p.variants) {
              const v = await variant(req.scope, item.id);
              if (
                !(v.price_set?.prices || []).some(
                  (x: any) =>
                    x.currency_code === "clp" &&
                    !x.price_list_id &&
                    Number(x.amount) > 0,
                )
              )
                throw new Error("Set a positive CLP price before publishing.");
            }
          }

          if (!ids.has(body.category_id))
            throw new Error("Select a group.");
          const root = categories.find((c) => c.handle === section.root);
          const category_ids = [
            ...new Set([
              ...(p.categories || [])
                .filter((c: any) => !ids.has(c.id))
                .map((c: any) => c.id),
              root.id,
              body.category_id,
            ]),
          ];
          await updateProductsWorkflow(req.scope).run({
            input: {
              products: [
                {
                  id: p.id,
                  ...fields,
                  category_ids,
                  metadata: {
                    ...p.metadata,
                    ...(fields.thumbnail !== p.thumbnail
                      ? {
                          image_url: fields.thumbnail || "",
                          product_cutout: fields.thumbnail || "",
                        }
                      : {}),
                    kind: section.kind,
                    ...(section.key === "sealed" ? { set, set_code, language } : { section: section.key }),
                  },
                },
              ],
            },
          });
        } else {
          if (!(p.variants || []).some((v: any) => v.id === body.variant_id))
            throw new Error("Variant does not belong to this product.");
          if (body.action === "sealed_price") {
            const amount = price(body.price_clp);
            // Preserve prices in other currencies; only replace base CLP pricing.
            const v = await variant(req.scope, body.variant_id);
            const prices = (v.price_set?.prices || [])
              .filter((p: any) => !p.price_list_id)
              .map((p: any) => ({
                id: p.id,
                currency_code: p.currency_code,
                amount: p.amount,
                min_quantity: p.min_quantity,
                max_quantity: p.max_quantity,
              }));
            const base = prices.find(
              (p: any) =>
                p.currency_code === "clp" && !p.min_quantity && !p.max_quantity,
            );
            if (base) base.amount = amount;
            else prices.push({ currency_code: "clp", amount });
            await updateProductVariantsWorkflow(req.scope).run({
              input: { product_variants: [{ id: body.variant_id, prices }] },
            });
          } else if (body.action === "sealed_stock") {
            const quantity = Number(body.quantity);
            if (
              !Number.isSafeInteger(quantity) ||
              quantity === 0 ||
              Math.abs(quantity) > 10000
            )
              throw new Error(
                "Enter a nonzero whole stock adjustment up to 10,000.",
              );
            if (typeof body.location_id !== "string" || !body.location_id)
              throw new Error("Select a warehouse.");
            await req.scope
              .resolve(Modules.STOCK_LOCATION)
              .retrieveStockLocation(body.location_id);
            const v = await variant(req.scope, body.variant_id);
            const links = v.inventory_items || [];
            if (
              !v.manage_inventory ||
              links.length !== 1 ||
              Number(links[0].required_quantity ?? 1) !== 1
            )
              throw new Error(
                "This variant needs a single managed inventory item.",
              );
            const item = links[0].inventory_item_id;
            await req.scope
              .resolve(Modules.LOCKING)
              .execute(`cms-inventory:${item}`, async () => {
                const inventory = req.scope.resolve(Modules.INVENTORY);
                const [level] = await inventory.listInventoryLevels(
                  { inventory_item_id: item, location_id: body.location_id },
                  { take: 1 },
                );
                if (
                  quantity < 0 &&
                  Number(level?.available_quantity || 0) < -quantity
                )
                  throw new Error(
                    "Not enough unreserved stock in this warehouse.",
                  );
                if (quantity > 0) {
                  const { data } = await req.scope
                    .resolve(ContainerRegistrationKeys.QUERY)
                    .graph({
                      entity: "product",
                      fields: ["id", "sales_channels.id"],
                      filters: { id: p.id },
                    });
                  const channels = (data[0]?.sales_channels || []).map(
                    (c: any) => c.id,
                  );
                  if (!channels.length)
                    throw new Error("Product has no sales channel.");
                  await linkSalesChannelsToStockLocationWorkflow(req.scope).run(
                    {
                      input: {
                        id: body.location_id,
                        add: await allowedStockChannels(req.scope,body.location_id,channels),
                        remove: [],
                      },
                    },
                  );
                }
                if (!level)
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
                else
                  await inventory.adjustInventory(
                    item,
                    body.location_id,
                    quantity,
                  );
              });
          } else throw new Error("Unknown sealed action.");
        }
        if (body.action === "sealed_stock") {
          const v = await variant(req.scope, body.variant_id);
          const levels = await req.scope
            .resolve(Modules.INVENTORY)
            .listInventoryLevels(
              { inventory_item_id: v.inventory_items[0].inventory_item_id },
              { take: 100 },
            );
          res.json({ ok: true, levels });
        } else res.json({ ok: true });
      });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
}
