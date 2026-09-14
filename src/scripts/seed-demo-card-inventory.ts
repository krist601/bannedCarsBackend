import { randomInt } from "node:crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow
} from "@medusajs/medusa/core-flows"

type Entity = { id: string }
type Printing = Entity & {
  name: string
  collector_number: string
  external_id?: string | null
  image_url?: string | null
  rarity?: string | null
  attributes?: Record<string, unknown> | null
}
type CatalogService = {
  listCardSets(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]>
  listCardPrintings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Printing[]>
  listCardListings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<Entity & { printing_id: string }>>
  createCardListings(data: Record<string, unknown>[]): Promise<Entity[]>
}
type SalesChannelService = { listSalesChannels(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]> }
type FulfillmentService = { listShippingProfiles(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]> }
type StockLocationService = { listStockLocations(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]> }
type Query = {
  graph<T>(input: Record<string, unknown>): Promise<{ data: T[] }>
}
type VariantInventory = {
  id: string
  sku: string
  inventory_items: Array<{ inventory_item_id: string }>
}

function shuffled<T>(values: T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

function priceClp(printing: Printing) {
  const data = printing.attributes?.scryfall_data
  const prices = data && typeof data === "object" ? (data as Record<string, unknown>).prices : null
  const source = prices && typeof prices === "object" ? prices as Record<string, unknown> : {}
  const usd = [source.usd, source.usd_foil, source.usd_etched]
    .map(value => typeof value === "string" ? Number(value) : NaN)
    .find(Number.isFinite)
  if (usd !== undefined) return Math.max(500, Math.round(usd * 1000 / 100) * 100)
  return { common: 1000, uncommon: 2000, rare: 5000, mythic: 10000 }[printing.rarity ?? ""] ?? 1500
}

function sku(printing: Printing) {
  return `DEMO-LTR-${printing.collector_number}-${printing.external_id ?? printing.id}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 120)
}

export default async function seedDemoCardInventory({ container }: ExecArgs) {
  const catalog = container.resolve("tcgCatalog") as CatalogService
  const [set] = await catalog.listCardSets({ code: "ltr" }, { take: 1 })
  if (!set) throw new Error("LTR is not imported. Run pnpm catalog:import-set LTR first.")

  const printings = await catalog.listCardPrintings({ set_id: set.id }, { take: 5000 })
  const existing = await catalog.listCardListings({}, { take: 5000 })
  const ltrPrintingIds = new Set(printings.map(printing => printing.id))
  const existingLtrCount = existing.filter(listing => ltrPrintingIds.has(listing.printing_id)).length
  const requestedCount = Math.max(0, 50 - existingLtrCount)
  if (requestedCount === 0) {
    console.log(`LTR already has ${existingLtrCount} card listings; no additional demo inventory was created.`)
    return
  }
  const listedPrintingIds = new Set(existing.map(listing => String(listing.printing_id)))
  const selected = shuffled(printings.filter(printing => !listedPrintingIds.has(printing.id))).slice(0, requestedCount)
  if (selected.length < requestedCount) throw new Error(`Only ${selected.length} unlisted LTR printings remain; ${requestedCount} are required.`)

  const salesChannelService = container.resolve(Modules.SALES_CHANNEL) as SalesChannelService
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as FulfillmentService
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as StockLocationService
  const [salesChannel] = await salesChannelService.listSalesChannels({}, { take: 1 })
  const [shippingProfile] = await fulfillmentService.listShippingProfiles({}, { take: 1 })
  if (!salesChannel || !shippingProfile) throw new Error("Medusa needs a sales channel and shipping profile before inventory can be seeded.")

  let [location] = await stockLocationService.listStockLocations({ name: "Banned Cards Warehouse" }, { take: 1 })
  if (!location) {
    location = (await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: "Banned Cards Warehouse", address: { address_1: "Local development", country_code: "cl", city: "Santiago" } }] }
    })).result[0]
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [salesChannel.id], remove: [] }
    })
  }

  const quantities = new Map(selected.map(printing => [printing.id, randomInt(1, 6)]))
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: selected.map(printing => ({
        title: printing.name,
        handle: `demo-ltr-${printing.external_id ?? printing.id}`.toLowerCase(),
        status: ProductStatus.PUBLISHED,
        thumbnail: printing.image_url ?? undefined,
        shipping_profile_id: shippingProfile.id,
        sales_channels: [{ id: salesChannel.id }],
        metadata: {
          game: "magic-the-gathering",
          kind: "single",
          collection: "Middle-earth",
          set: "The Lord of the Rings: Tales of Middle-earth",
          printing_id: printing.id,
          demo_inventory: true
        },
        options: [{ title: "Card", values: ["Near Mint / English / Non-foil"] }],
        variants: [{
          title: "Near Mint / English / Non-foil",
          sku: sku(printing),
          manage_inventory: true,
          allow_backorder: false,
          options: { Card: "Near Mint / English / Non-foil" },
          prices: [{ currency_code: "clp", amount: priceClp(printing) }]
        }]
      }))
    }
  })

  const variantIds = products.flatMap(product => product.variants?.map(variant => variant.id) ?? [])
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query
  const { data: variants } = await query.graph<VariantInventory>({
    entity: "product_variant",
    fields: ["id", "sku", "inventory_items.inventory_item_id"],
    filters: { id: variantIds }
  })
  const variantBySku = new Map(variants.map(variant => [variant.sku, variant]))
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: selected.map(printing => {
        const variant = variantBySku.get(sku(printing))
        const inventoryItemId = variant?.inventory_items[0]?.inventory_item_id
        if (!inventoryItemId) throw new Error(`No inventory item was created for ${printing.name}`)
        return { inventory_item_id: inventoryItemId, location_id: location.id, stocked_quantity: quantities.get(printing.id)! }
      })
    }
  })

  const productByVariantId = new Map(products.flatMap(product => (product.variants ?? []).map(variant => [variant.id, product.id])))
  await catalog.createCardListings(selected.map(printing => {
    const variant = variantBySku.get(sku(printing))!
    return {
      printing_id: printing.id,
      product_id: productByVariantId.get(variant.id),
      variant_id: variant.id,
      sku: sku(printing),
      condition: "near_mint",
      language: "English",
      finish: "non_foil",
      price_clp: priceClp(printing),
      quantity: quantities.get(printing.id),
      storage_location: location.id,
      metadata: { demo_inventory: true, price_source: "scryfall_usd_x_1000_or_rarity_fallback" }
    }
  }))

  console.log(`Seeded ${selected.length} random LTR card listings with quantities from 1 to 5 at Banned Cards Warehouse.`)
}
