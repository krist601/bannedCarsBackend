const assert = require("node:assert/strict")
const test = require("node:test")
const { projectCardCatalogue } = require("../src/lib/card-catalogue-projection")

const set = { id: "set_ltr", code: "ltr", name: "The Lord of the Rings" }
const printing = {
  id: "printing_1",
  set_id: set.id,
  collector_number: "1",
  name: "Frodo",
  rarity: "rare",
  external_id: "scryfall_1",
  image_url: "https://cards.scryfall.io/normal/frodo.jpg",
  attributes: { scryfall_data: { colors: ["W", "B"] } }
}

test("unlisted printings remain discoverable as unavailable catalogue cards", () => {
  const [card] = projectCardCatalogue([printing], [set], [])
  assert.equal(card.id, "printing:printing_1")
  assert.equal(card.price_clp, null)
  assert.equal(card.stock, 0)
  assert.equal(card.condition, "Not listed")
  assert.equal(card.collection, "Middle-earth")
  assert.equal(card.colors, "WB")
})

test("linked listings expose their variant, price, condition, and stock", () => {
  const [card] = projectCardCatalogue([printing], [set], [{
    id: "listing_1",
    printing_id: printing.id,
    variant_id: "variant_1",
    condition: "near_mint",
    language: "English",
    finish: "non_foil",
    price_clp: 15990,
    quantity: 3
  }])
  assert.equal(card.id, "variant_1")
  assert.equal(card.price_clp, 15990)
  assert.equal(card.stock, 3)
  assert.equal(card.condition, "Near Mint")
  assert.equal(card.finish, "Non-foil")
})

test("a listing without a Medusa variant cannot be added as available stock", () => {
  const [card] = projectCardCatalogue([printing], [set], [{
    id: "listing_1",
    printing_id: printing.id,
    variant_id: null,
    condition: "near_mint",
    price_clp: 15990,
    quantity: 3
  }])
  assert.equal(card.price_clp, 15990)
  assert.equal(card.stock, 0)
})


test("unsynced images never expose Scryfall URLs to the storefront", () => {
  const [card] = projectCardCatalogue([{ ...printing, attributes: {
    scryfall_normal_image_url: printing.image_url,
    scryfall_small_image_url: "https://cards.scryfall.io/small/frodo.jpg"
  } }], [set], [])
  assert.equal(card.image_url, null)
  assert.equal(card.image_small_url, null)
})

test("catalogue uses stored images even when original URL fields are stale", () => {
  const normal = "http://localhost:9002/banned-cards/catalog/frodo.jpg"
  const small = "http://localhost:9002/banned-cards/catalog/frodo-small.jpg"
  const [card] = projectCardCatalogue([{ ...printing, attributes: {
    image_storage_url: normal,
    image_small_storage_url: small
  } }], [set], [])
  assert.equal(card.image_url, normal)
  assert.equal(card.image_small_url, small)
})
