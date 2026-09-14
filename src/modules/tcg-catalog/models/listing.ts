import { model } from "@medusajs/framework/utils"

/** Sellable inventory record. A product may have several listings by condition or language. */
const Listing = model.define("catalog_listing", {
  id: model.id().primaryKey(),
  catalog_product_id: model.text().index(),
  product_id: model.text().index().nullable(),
  variant_id: model.text().index().nullable(),
  sku: model.text().unique(),
  condition: model.text().nullable(),
  language: model.text().nullable(),
  finish: model.text().nullable(),
  price_clp: model.number(),
  quantity: model.number().default(0),
  photos: model.json().nullable(),
  metadata: model.json().nullable()
})

export default Listing
