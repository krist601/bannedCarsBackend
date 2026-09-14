import { model } from "@medusajs/framework/utils"

const Game = model.define("tcg_game", {
  id: model.id().primaryKey(),
  handle: model.text().unique(),
  name: model.text(),
  publisher: model.text().nullable(),
  metadata: model.json().nullable()
})

export default Game
