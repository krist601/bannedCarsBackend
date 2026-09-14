import { model } from "@medusajs/framework/utils"

const CardListing = model.define("card_listing", {
  id: model.id().primaryKey(),
  printing_id: model.text().index(),
  product_id: model.text().index().nullable(),
  variant_id: model.text().index().nullable(),
  sku: model.text().unique(),
  condition: model.enum(["near_mint", "lightly_played", "moderately_played", "heavily_played", "damaged"]),
  language: model.text().default("English"),
  finish: model.enum(["non_foil", "foil", "etched", "other"]).default("non_foil"),
  price_clp: model.number(),
  quantity: model.number().default(0),
  storage_location: model.text().nullable(),
  photos: model.json().nullable(),
  metadata: model.json().nullable()
})

export default CardListing
