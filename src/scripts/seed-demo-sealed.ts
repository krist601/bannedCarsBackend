import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { createProductsWorkflow, createInventoryLevelsWorkflow, linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows"

export default async function seedDemoSealed({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)
  const [category] = await productService.listProductCategories({ handle: "sealed-products" })
  const [channel] = await container.resolve(Modules.SALES_CHANNEL).listSalesChannels({}, { take: 1 })
  const [profile] = await container.resolve(Modules.FULFILLMENT).listShippingProfiles({}, { take: 1 })
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: "Banned Cards Warehouse" }, { take: 1 })
  if (!category || !channel || !profile || !location) throw new Error("Sealed category, sales channel, shipping profile and warehouse are required.")
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: location.id, add: [channel.id], remove: [] } })
  const samples = [
    { handle: "demo-sealed-booster-box", title: "Demo Play Booster Box", image: "booster-box", price: 149990, stock: 6 },
    { handle: "demo-sealed-commander-deck", title: "Demo Commander Deck", image: "commander-deck", price: 54990, stock: 12 }
  ]
  for (const sample of samples) {
    const [existing] = await productService.listProducts({ handle: sample.handle })
    if (existing) { console.log(`Already exists: ${sample.title}; unchanged.`); continue }
    const { result } = await createProductsWorkflow(container).run({ input: { products: [{
      title: sample.title, handle: sample.handle, status: ProductStatus.PUBLISHED,
      description: "Sample sealed product for local storefront testing. Price and inventory are illustrative.",
      thumbnail: `/demo/${sample.image}.svg`,
      category_ids: [category.id], shipping_profile_id: profile.id, sales_channels: [{ id: channel.id }],
      metadata: { kind: "sealed", game: "magic-the-gathering", set: "Demo collection", demo_inventory: true, finish: "Sealed", condition: "Factory sealed" },
      options: [{ title: "Language", values: ["English"] }],
      variants: [{ title: "English", sku: sample.handle.toUpperCase(), manage_inventory: true, allow_backorder: false, options: { Language: "English" }, prices: [{ currency_code: "clp", amount: sample.price }] }]
    }] } })
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({ entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"], filters: { id: result[0].variants!.map(v => v.id) } })
    const inventoryId = data[0]?.inventory_items?.[0]?.inventory_item_id
    if (!inventoryId) throw new Error(`Inventory item missing for ${sample.title}`)
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: [{ inventory_item_id: inventoryId, location_id: location.id, stocked_quantity: sample.stock }] } })
    console.log(`Created ${sample.title}: CLP ${sample.price}, stock ${sample.stock}`)
  }
}
