import { model } from "@medusajs/framework/utils"

/** Generic commercial item: a single, sealed product, or accessory in any TCG. */
const Product = model.define("catalog_product", {
  id: model.id().primaryKey(),
  game_id: model.text().index().nullable(),
  kind: model.enum(["single", "sealed", "accessory"]),
  title: model.text().index(),
  handle: model.text().unique(),
  description: model.text().nullable(),
  attributes: model.json().nullable(),
  metadata: model.json().nullable()
})

export default Product
