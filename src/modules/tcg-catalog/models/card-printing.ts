import { model } from "@medusajs/framework/utils"

const CardPrinting = model.define("card_printing", {
  id: model.id().primaryKey(),
  game_id: model.text().index(),
  set_id: model.text().index(),
  collector_number: model.text(),
  name: model.text().index(),
  rarity: model.text().nullable(),
  external_id: model.text().index().nullable(),
  image_source: model.text().nullable(),
  image_url: model.text().nullable(),
  image_small_url: model.text().nullable(),
  attributes: model.json().nullable()
})

export default CardPrinting
