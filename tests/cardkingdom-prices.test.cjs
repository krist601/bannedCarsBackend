const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { gzipSync } = require('node:zlib')
const { Modules } = require('@medusajs/framework/utils')
const { ckFromEntry, scryfallToUuid, cardKingdomPricesForSet, syncCardKingdomPrices, clearCardKingdomCache } = require('../src/lib/cardkingdom-prices')
const { basePrices, basePriceSources } = require('../src/lib/cms-base-prices')
const { fetchSetPrices } = require('../src/lib/cms-set-prices')

beforeEach(() => clearCardKingdomCache())

const entry = (retail) => ({ paper: { cardkingdom: { currency: 'USD', retail, buylist: { normal: { '2026-10-08': 1 } } } } })
const prices = {
  data: {
    'uuid-ring': entry({ normal: { '2026-10-07': 140, '2026-10-08': 149.99 }, foil: { '2026-10-08': 199.99 } }),
    'uuid-bulk': entry({ normal: { '2026-10-08': 0.25 } }),
    'uuid-none': { paper: { tcgplayer: { retail: { normal: { '2026-10-08': 5 } } } } },
  },
}
const setFile = { data: { cards: [
  { uuid: 'uuid-ring', identifiers: { scryfallId: 'sf-ring' } }, { uuid: 'uuid-bulk', identifiers: { scryfallId: 'sf-bulk' } },
  { uuid: 'uuid-none', identifiers: { scryfallId: 'sf-none' } }, { uuid: 'uuid-x', identifiers: {} },
] } }
const respond = (body) => ({ ok: true, status: 200, arrayBuffer: async () => { const b = gzipSync(Buffer.from(JSON.stringify(body))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } })
const mtgjson = (files) => async (url) => {
  const hit = Object.entries(files).find(([name]) => url.endsWith(`/${name}`))
  return hit ? respond(hit[1]) : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
}

test('only retail prices count, the newest date wins, and cards without Card Kingdom prices are skipped', () => {
  assert.deepEqual(ckFromEntry(prices.data['uuid-ring']), { usd: 149.99, usd_foil: 199.99, date: '2026-10-08' })
  assert.deepEqual(ckFromEntry(prices.data['uuid-bulk']), { usd: 0.25, date: '2026-10-08' })
  assert.equal(ckFromEntry(prices.data['uuid-none']), null); assert.equal(ckFromEntry(undefined), null)
  assert.equal(ckFromEntry({ paper: { cardkingdom: { buylist: { normal: { '2026-10-08': 3 } } } } }), null)
})
test('Scryfall ids are linked to MTGJSON ids from the set file', () => {
  assert.deepEqual([...scryfallToUuid(setFile)], [['sf-ring', 'uuid-ring'], ['sf-bulk', 'uuid-bulk'], ['sf-none', 'uuid-none']])
})
test('a set gets its Card Kingdom prices by Scryfall id, with the underscore variant for clashing codes', async () => {
  const map = await cardKingdomPricesForSet('ltr', mtgjson({ 'AllPricesToday.json.gz': prices, 'LTR.json.gz': setFile }))
  assert.deepEqual([...map.keys()], ['sf-ring', 'sf-bulk']); assert.equal(map.get('sf-ring').usd, 149.99)
  clearCardKingdomCache()
  const underscore = await cardKingdomPricesForSet('con', mtgjson({ 'AllPricesToday.json.gz': prices, 'CON_.json.gz': setFile }))
  assert.equal(underscore.size, 2)
  clearCardKingdomCache()
  assert.equal(await cardKingdomPricesForSet('zzz', mtgjson({ 'AllPricesToday.json.gz': prices })), null)
  await assert.rejects(cardKingdomPricesForSet('../x', mtgjson({})), /Invalid set code/)
})
test('the price source decides the base price, and Scryfall fills the gaps', () => {
  const printing = { attributes: { scryfall_data: { prices: { usd: '100.00', usd_foil: '120.00' } }, ck_prices: { usd: 149.99 } } }
  const rate = { rate: 1000, minimum: 300, rounding: 50 }
  assert.equal(basePrices(printing, { ...rate, source: 'scryfall' }).non_foil, 100000)
  assert.equal(basePrices(printing, { ...rate, source: 'cardkingdom' }).non_foil, 150000)
  assert.equal(basePrices(printing, { ...rate, source: 'cardkingdom' }).foil, 120000) // Card Kingdom has no foil price
  assert.equal(basePrices({ attributes: { scryfall_data: { prices: { usd: '5' } } } }, { ...rate, source: 'cardkingdom' }).non_foil, 5000)
  assert.deepEqual(basePriceSources(printing, { ...rate, source: 'cardkingdom' }), { non_foil: 'cardkingdom', foil: 'scryfall', etched: null })
  assert.deepEqual(basePriceSources(printing, { ...rate, source: 'scryfall' }), { non_foil: 'scryfall', foil: 'scryfall', etched: null })
})
test('the preview table shows Card Kingdom prices first and labels where each price came from', async () => {
  const scryfall = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'sf-ring', name: 'The One Ring', collector_number: '246', set: 'ltr', prices: { usd: '100.00', usd_foil: '120.00' } }, { id: 'sf-other', name: 'Other', collector_number: '1', set: 'ltr', prices: { usd: '2.00' } }], has_more: false }) })
  const rows = await fetchSetPrices('ltr', scryfall, { rate: 1000, minimum: 300, rounding: 50, source: 'cardkingdom' }, new Map([['sf-ring', { usd: 149.99 }]]))
  const ring = rows.find(row => row.id === 'sf-ring'), other = rows.find(row => row.id === 'sf-other')
  assert.deepEqual(ring.prices.map(p => [p.finish, p.usd, p.clp, p.source]), [['Non-foil', 149.99, 150000, 'Card Kingdom'], ['Foil', '120.00', 120000, 'Scryfall'], ['Etched', null, null, null]])
  assert.equal(other.prices[0].source, 'Scryfall')
})
test('syncing saves Card Kingdom prices on printings, changes nothing the second time, and clears prices that disappear', async () => {
  const printings = [{ id: 'p1', external_id: 'sf-ring', attributes: { scryfall_data: {} } }, { id: 'p2', external_id: 'sf-none', attributes: { ck_prices: { usd: 9 } } }, { id: 'p3', external_id: 'sf-bulk', attributes: {} }]
  const updates = []
  const catalog = {
    listCardSets: async (filters) => (filters.code && filters.code !== 'ltr' ? [] : [{ id: 's1', code: 'ltr' }]),
    listCardPrintings: async (_f, { skip }) => (skip ? [] : printings),
    updateCardPrintings: async (patch) => { updates.push(patch); Object.assign(printings.find(p => p.id === patch.id), { attributes: patch.attributes }) },
  }
  const store = { metadata: {} }
  const scope = { resolve: key => key === 'tcgCatalog' ? catalog : key === Modules.STORE ? { listStores: async () => [store], updateStores: async (_id, patch) => { store.metadata = patch.metadata } } : undefined }
  const fetcher = mtgjson({ 'AllPricesToday.json.gz': prices, 'LTR.json.gz': setFile })
  const first = await syncCardKingdomPrices(scope, { fetcher })
  assert.deepEqual([first.sets, first.printings, first.matched, first.updated], [1, 3, 2, 3])
  assert.equal(printings[0].attributes.ck_prices.usd, 149.99); assert.equal(printings[1].attributes.ck_prices, null); assert.equal(printings[0].attributes.scryfall_data !== undefined, true)
  assert.equal(store.metadata.ck_prices_sync.matched, 2)
  updates.length = 0
  const second = await syncCardKingdomPrices(scope, { fetcher })
  assert.equal(second.updated, 0); assert.equal(updates.length, 0)
  clearCardKingdomCache()
  const missing = await syncCardKingdomPrices(scope, { fetcher: mtgjson({ 'AllPricesToday.json.gz': prices }), codes: ['ltr'] })
  assert.deepEqual(missing.without_file, ['ltr'])
})
