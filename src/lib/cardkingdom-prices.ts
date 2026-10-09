import { gunzipSync } from "node:zlib"
import { Modules } from "@medusajs/framework/utils"

/**
 * Card Kingdom retail prices (USD, Near Mint), read from MTGJSON, which republishes them every day.
 * Card Kingdom's own price list sits behind an anti-bot check that blocks servers, so it cannot be called directly.
 *  - https://mtgjson.com/api/v5/AllPricesToday.json.gz : prices by MTGJSON card id (uuid)
 *  - https://mtgjson.com/api/v5/<SET>.json.gz          : the set's cards, linking each uuid to its Scryfall id
 */
export type CkPrices = { usd?: number; usd_foil?: number; usd_etched?: number; date?: string }
export type PriceSource = "scryfall" | "cardkingdom"

const BASE = "https://mtgjson.com/api/v5"
const HEADERS = { "User-Agent": "BannedCardsCMS/1.0 (price-sync)", Accept: "application/json, application/gzip" }
const CACHE_MS = 30 * 60_000
const MAX_BYTES = 120 * 1024 * 1024

async function downloadJson(url: string, fetcher: typeof fetch, maxBytes = MAX_BYTES): Promise<any | null> {
  const response = await fetcher(url, { headers: HEADERS, signal: AbortSignal.timeout(180_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`MTGJSON returned HTTP ${response.status}. Please try again later.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > maxBytes) throw new Error("MTGJSON sent an unexpected file size.")
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  try { return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString("utf8")) }
  catch { throw new Error("MTGJSON sent a file that could not be read.") }
}

/** The most recent value of a { "2026-10-08": 7.99 } series. */
function latest(series?: Record<string, number>): { value: number; date: string } | null {
  if (!series) return null
  const date = Object.keys(series).sort().pop()
  const value = date ? Number(series[date]) : NaN
  return date && Number.isFinite(value) && value > 0 ? { value: Math.round(value * 100) / 100, date } : null
}

/** One card's Card Kingdom retail prices out of MTGJSON's price entry; null when Card Kingdom has none. */
export function ckFromEntry(entry: any): CkPrices | null {
  const retail = entry?.paper?.cardkingdom?.retail
  if (!retail) return null
  const normal = latest(retail.normal), foil = latest(retail.foil), etched = latest(retail.etched)
  if (!normal && !foil && !etched) return null
  const dates = [normal, foil, etched].filter(Boolean).map(found => found!.date).sort()
  return { ...(normal ? { usd: normal.value } : {}), ...(foil ? { usd_foil: foil.value } : {}), ...(etched ? { usd_etched: etched.value } : {}), date: dates[dates.length - 1] }
}

/** Scryfall id → MTGJSON uuid for the cards of one set file. */
export function scryfallToUuid(setFile: any): Map<string, string> {
  const map = new Map<string, string>()
  for (const card of setFile?.data?.cards ?? []) {
    const scryfallId = card?.identifiers?.scryfallId
    if (typeof scryfallId === "string" && typeof card.uuid === "string") map.set(scryfallId, card.uuid)
  }
  return map
}

let indexCache: { expires: number; index: Map<string, CkPrices> } | null = null
let indexPending: Promise<Map<string, CkPrices>> | null = null
/** All Card Kingdom prices of the day by MTGJSON uuid (about 100,000 cards), kept for 30 minutes. */
export async function loadCardKingdomIndex(fetcher: typeof fetch = fetch): Promise<Map<string, CkPrices>> {
  if (indexCache && indexCache.expires > Date.now()) return indexCache.index
  indexPending ??= (async () => {
    const file = await downloadJson(`${BASE}/AllPricesToday.json.gz`, fetcher)
    if (!file?.data || typeof file.data !== "object") throw new Error("MTGJSON sent an empty price list.")
    const index = new Map<string, CkPrices>()
    for (const [uuid, entry] of Object.entries(file.data)) { const prices = ckFromEntry(entry); if (prices) index.set(uuid, prices) }
    indexCache = { expires: Date.now() + CACHE_MS, index }
    return index
  })().finally(() => { indexPending = null })
  return indexPending
}

const setCache = new Map<string, { expires: number; map: Map<string, CkPrices> | null }>()
/**
 * Card Kingdom prices of a set by Scryfall id, or null when MTGJSON has no file for the set.
 * MTGJSON adds an underscore to set codes that clash with Windows file names (CON → CON_), so both are tried.
 */
export async function cardKingdomPricesForSet(code: string, fetcher: typeof fetch = fetch): Promise<Map<string, CkPrices> | null> {
  if (!/^[a-z0-9]{2,12}$/i.test(code)) throw new Error("Invalid set code.")
  const key = code.toLowerCase()
  const cached = setCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.map
  const index = await loadCardKingdomIndex(fetcher)
  let setFile: any = null
  for (const candidate of [code.toUpperCase(), `${code.toUpperCase()}_`]) { setFile = await downloadJson(`${BASE}/${candidate}.json.gz`, fetcher, 40 * 1024 * 1024); if (setFile) break }
  let map: Map<string, CkPrices> | null = null
  if (setFile) {
    map = new Map()
    for (const [scryfallId, uuid] of scryfallToUuid(setFile)) { const prices = index.get(uuid); if (prices) map.set(scryfallId, prices) }
  }
  if (setCache.size >= 200) setCache.delete(setCache.keys().next().value!)
  setCache.set(key, { expires: Date.now() + CACHE_MS, map })
  return map
}
export const clearCardKingdomCache = () => { indexCache = null; setCache.clear() }

export type CkSyncSummary = { sets: number; printings: number; matched: number; updated: number; without_file: string[]; at: string }

/**
 * Saves the Card Kingdom price on every imported printing (attribute ck_prices). Listing prices are not touched:
 * they change only when "Update prices" is used for a set, so you stay in control of when your prices move.
 */
export async function syncCardKingdomPrices(scope: any, options: { codes?: string[]; fetcher?: typeof fetch } = {}): Promise<CkSyncSummary> {
  const catalog = scope.resolve("tcgCatalog")
  const fetcher = options.fetcher ?? fetch
  const sets: any[] = []
  if (options.codes) { for (const code of options.codes) { const [set] = await catalog.listCardSets({ code: code.toLowerCase() }, { take: 1 }); if (set) sets.push(set) } }
  else for (let skip = 0; ; skip += 200) { const page = await catalog.listCardSets({}, { take: 200, skip, order: { id: "ASC" } }); sets.push(...page); if (page.length < 200) break }
  const summary: CkSyncSummary = { sets: 0, printings: 0, matched: 0, updated: 0, without_file: [], at: new Date().toISOString() }
  for (const set of sets) {
    const prices = await cardKingdomPricesForSet(String(set.code), fetcher)
    if (!prices) { summary.without_file.push(String(set.code)); continue }
    summary.sets++
    for (let skip = 0; ; skip += 200) {
      const printings = await catalog.listCardPrintings({ set_id: set.id }, { take: 200, skip, order: { id: "ASC" } })
      for (const printing of printings) {
        summary.printings++
        const found = prices.get(String(printing.external_id)) ?? null
        if (found) summary.matched++
        const current = printing.attributes?.ck_prices ?? null
        if (JSON.stringify(current) === JSON.stringify(found)) continue
        await catalog.updateCardPrintings({ id: printing.id, attributes: { ...printing.attributes, ck_prices: found } })
        summary.updated++
      }
      if (printings.length < 200) break
    }
  }
  await rememberSync(scope, summary)
  return summary
}

async function rememberSync(scope: any, summary: CkSyncSummary) {
  try {
    const service = scope.resolve(Modules.STORE)
    const [store] = await service.listStores({}, { take: 1 })
    if (store) await service.updateStores(store.id, { metadata: { ...store.metadata, ck_prices_sync: summary } })
  } catch { /* the prices are saved either way */ }
}
export async function lastCardKingdomSync(scope: any): Promise<CkSyncSummary | null> {
  const [store] = await scope.resolve(Modules.STORE).listStores({}, { take: 1 })
  return store?.metadata?.ck_prices_sync ?? null
}
