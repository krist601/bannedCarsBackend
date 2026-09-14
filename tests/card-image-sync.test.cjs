const { test } = require("node:test")
const assert = require("node:assert/strict")
const { syncCardImages } = require("../src/lib/card-image-sync")

const source = "https://cards.scryfall.io/normal/front/a/b/example.jpg"
const smallSource = "https://cards.scryfall.io/small/front/a/b/example.jpg"
const printing = {
  id: "printing_1",
  external_id: "scryfall_1",
  image_source: "scryfall",
  image_url: source,
  image_small_url: smallSource,
  attributes: { collector_number: "1" }
}

test("downloads each size, stores public URLs and preserves Scryfall sources", async () => {
  const uploads = []
  const updates = []
  const linked = []
  const summary = await syncCardImages([printing], {
    fetcher: async url => new Response(Buffer.from(`image:${url}`), { headers: { "content-type": "image/jpeg" } }),
    storage: { upload: async input => { uploads.push(input); return { id: `file_${uploads.length}`, url: `http://storage.test/${input.filename}` } } },
    writer: { update: async (id, data) => updates.push({ id, data }) },
    onStored: async (record, url) => linked.push({ id: record.id, url }),
    logger: { info() {}, warn() {}, error() {} }
  })

  assert.deepEqual(summary, { discovered: 1, uploaded: 1, skipped: 0, failed: 0 })
  assert.equal(uploads.length, 2)
  assert.match(uploads[0].filename, /scryfall_1-normal\.jpg$/)
  assert.equal(updates[0].data.attributes.scryfall_normal_image_url, source)
  assert.equal(updates[0].data.attributes.scryfall_small_image_url, smallSource)
  assert.equal(linked[0].url, updates[0].data.image_url)
})

test("is idempotent after storage metadata is recorded", async () => {
  let uploadCount = 0
  let linkedUrl = ""
  const stored = { ...printing, attributes: { image_storage_url: "http://storage.test/normal.jpg", image_small_storage_url: "http://storage.test/small.jpg" } }
  const summary = await syncCardImages([stored], {
    storage: { upload: async () => { uploadCount++; throw new Error("must not upload") } },
    writer: { update: async () => { throw new Error("must not update") } },
    onStored: async (_record, url) => { linkedUrl = url },
    logger: { info() {}, warn() {}, error() {} }
  })
  assert.equal(uploadCount, 0)
  assert.equal(linkedUrl, stored.attributes.image_storage_url)
  assert.equal(summary.skipped, 1)
})

test("refuses non-Scryfall source hosts", async () => {
  const errors = []
  const summary = await syncCardImages([{ ...printing, image_url: "https://example.com/card.jpg", image_small_url: null }], {
    storage: { upload: async () => { throw new Error("must not upload") } },
    writer: { update: async () => {} },
    logger: { info() {}, warn() {}, error(message) { errors.push(message) } }
  })
  assert.equal(summary.failed, 1)
  assert.match(errors[0], /non-Scryfall/)
})

test("removes newly uploaded files when the database update fails", async () => {
  const uploaded = []
  const removed = []
  const summary = await syncCardImages([printing], {
    fetcher: async () => new Response(Buffer.from("image"), { headers: { "content-type": "image/jpeg" } }),
    storage: {
      upload: async input => { const file = { id: input.filename, url: `http://storage.test/${input.filename}` }; uploaded.push(file.id); return file },
      remove: async ids => removed.push(...ids)
    },
    writer: { update: async () => { throw new Error("database unavailable") } },
    logger: { info() {}, warn() {}, error() {} }
  })
  assert.equal(summary.failed, 1)
  assert.deepEqual(removed, uploaded)
})
