import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/** Safe to rerun: creates the storefront category without changing existing products. */
export default async function configureSealedCatalogue({ container }: ExecArgs) {
  const products = container.resolve(Modules.PRODUCT)
  const [existing] = await products.listProductCategories({ handle: "sealed-products" })
  if (existing) {
    console.log(`Sealed category already exists: ${existing.id}`)
    return
  }
  const category = await products.createProductCategories({
    name: "Sealed products", handle: "sealed-products", is_active: true, is_internal: false,
    description: "Factory-sealed booster packs, boxes, bundles and decks."
  })
  console.log(`Created sealed category: ${category.id}`)
}
