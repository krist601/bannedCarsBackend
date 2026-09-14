import { model } from "@medusajs/framework/utils"

const CardSet = model.define("tcg_set", {
  id: model.id().primaryKey(),
  game_id: model.text().index(),
  code: model.text(),
  name: model.text(),
  released_at: model.dateTime().nullable(),
  metadata: model.json().nullable()
})

export default CardSet
