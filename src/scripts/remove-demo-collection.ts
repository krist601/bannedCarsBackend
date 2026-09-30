import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/** Archive only the original placeholder products; preserve carts and inventory records. */
export default async function removeDemoCollection({ container }: ExecArgs) {
  const products = container.resolve(Modules.PRODUCT)
  for (const handle of ["demo-sealed-booster-box", "demo-sealed-commander-deck"]) {
    const [product] = await products.listProducts({ handle })
    if (!product) { console.log(`Already absent: ${handle}`); continue }
    if (product.metadata?.set !== "Demo collection" || product.metadata?.demo_inventory !== true) {
      throw new Error(`Refusing to archive changed product: ${handle}`)
    }
    await products.updateProducts(product.id, { status: "draft" })
    console.log(`Removed from storefront: ${product.title}`)
  }
}
