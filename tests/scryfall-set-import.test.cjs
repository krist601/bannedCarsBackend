const assert = require("node:assert/strict")
const test = require("node:test")
const { importScryfallSet, normalizeScryfallSetCode } = require("../src/lib/scryfall-set-import")

function response(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

test("normalizes TLR to Scryfall's LTR set code", () => {
  assert.equal(normalizeScryfallSetCode("TLR"), "ltr")
  assert.equal(normalizeScryfallSetCode("mh3"), "mh3")
})

test("imports all pages and creates new card printings", async () => {
  const requested = []
  const created = []
  const set = { id: "set-id", code: "ltr", name: "The Lord of the Rings", released_at: "2023-06-23" }
  const card1 = { id: "card-1", oracle_id: "oracle-1", name: "Frodo", collector_number: "1", rarity: "rare", set: "ltr", image_uris: { normal: "https://cards.scryfall.io/normal/1.jpg", small: "https://cards.scryfall.io/small/1.jpg" } }
  const card2 = { id: "card-2", name: "Sam", collector_number: "2", set: "ltr", image_uris: { normal: "https://cards.scryfall.io/normal/2.jpg" } }
  const fetcher = async url => {
    requested.push(String(url))
    if (String(url).endsWith("/sets/ltr")) return response(set)
    if (String(url) === "https://next.test/page-2") return response({ data: [card2], has_more: false })
    return response({ data: [card1], has_more: true, next_page: "https://next.test/page-2" })
  }
  const result = await importScryfallSet("TLR", {
    fetcher, wait: async () => {}, logger: { info() {} },
    store: {
      ensureMagicGame: async () => ({ id: "game-1" }),
      upsertSet: async () => ({ id: "db-set-1" }),
      listPrintings: async () => [],
      createPrinting: async data => { created.push(data) },
      updatePrinting: async () => assert.fail("unexpected update")
    }
  })
  assert.equal(requested.length, 3)
  assert.deepEqual(result, { requestedCode: "TLR", setCode: "ltr", setName: set.name, discovered: 2, created: 2, updated: 0 })
  assert.equal(created[0].external_id, "card-1")
  assert.equal(created[0].image_url, card1.image_uris.normal)
  assert.deepEqual(created[0].attributes.scryfall_data, card1)
  assert.equal(created[1].image_small_url, card2.image_uris.normal)
})

test("updates existing cards without replacing managed image URLs", async () => {
  const updates = []
  const card = { id: "card-1", name: "Updated Frodo", collector_number: "1", set: "ltr", image_uris: { normal: "https://cards.scryfall.io/new.jpg" } }
  const result = await importScryfallSet("ltr", {
    fetcher: async url => String(url).includes("/sets/")
      ? response({ id: "set-id", code: "ltr", name: "LOTR" })
      : response({ data: [card], has_more: false }),
    wait: async () => {},
    store: {
      ensureMagicGame: async () => ({ id: "game-1" }),
      upsertSet: async () => ({ id: "set-1" }),
      listPrintings: async () => [{ id: "printing-1", external_id: "card-1", image_url: "http://localhost:9002/stored.jpg", attributes: { image_storage_url: "http://localhost:9002/stored.jpg" } }],
      createPrinting: async () => assert.fail("unexpected create"),
      updatePrinting: async (id, data) => updates.push({ id, data })
    }
  })
  assert.equal(result.updated, 1)
  assert.equal(updates[0].id, "printing-1")
  assert.equal(updates[0].data.image_url, "http://localhost:9002/stored.jpg")
  assert.equal(updates[0].data.attributes.scryfall_normal_image_url, card.image_uris.normal)
})
