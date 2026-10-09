export const SCRYFALL_API = "https://api.scryfall.com"
const REQUEST_INTERVAL_MS = 100
const SET_ALIASES: Record<string, string> = { tlr: "ltr" }

export type ScryfallSet = { id: string; code: string; name: string; released_at?: string | null; [key: string]: unknown }
export type ScryfallCard = {
  id: string; oracle_id?: string; name: string; collector_number: string; rarity?: string; set: string
  image_uris?: Record<string, string>
  card_faces?: Array<{ image_uris?: Record<string, string>; [key: string]: unknown }>
  [key: string]: unknown
}
type ScryfallList = { data: ScryfallCard[]; has_more: boolean; next_page?: string }
export type ExistingPrinting = {
  id: string; external_id?: string | null; image_url?: string | null; image_small_url?: string | null
  attributes?: Record<string, unknown> | null
}
export type SetImportStore = {
  ensureMagicGame(): Promise<{ id: string }>
  upsertSet(gameId: string, set: ScryfallSet): Promise<{ id: string }>
  listPrintings(setId: string): Promise<ExistingPrinting[]>
  createPrinting(data: Record<string, unknown>): Promise<void>
  updatePrinting(id: string, data: Record<string, unknown>): Promise<void>
}
export type SetImportSummary = { requestedCode: string; setCode: string; setName: string; discovered: number; created: number; updated: number }
type ImportOptions = {
  store: SetImportStore; fetcher?: typeof fetch; wait?: (milliseconds: number) => Promise<void>; logger?: Pick<Console, "info">
}

export function normalizeScryfallSetCode(value: string) {
  const requested = value.trim().toLowerCase()
  if (!/^[a-z0-9]{2,8}$/.test(requested)) throw new Error("Set code must contain 2-8 letters or numbers")
  return SET_ALIASES[requested] ?? requested
}

export async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      "User-Agent": process.env.SCRYFALL_USER_AGENT || "BannedCards/0.1 (catalog-import)",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Scryfall request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<T>
}

function imageUrls(card: ScryfallCard) {
  const images = card.image_uris ?? card.card_faces?.find(face => face.image_uris)?.image_uris
  return { normal: images?.normal ?? images?.large ?? null, small: images?.small ?? images?.normal ?? images?.large ?? null }
}

export function printingData(card: ScryfallCard, gameId: string, setId: string, existing?: ExistingPrinting) {
  const images = imageUrls(card)
  const priorAttributes = existing?.attributes ?? {}
  const hasStoredImages = typeof priorAttributes.image_storage_url === "string"
  return {
    game_id: gameId, set_id: setId, collector_number: card.collector_number, name: card.name,
    rarity: card.rarity ?? null, external_id: card.id, image_source: "scryfall",
    image_url: hasStoredImages ? existing?.image_url ?? images.normal : images.normal,
    image_small_url: hasStoredImages ? existing?.image_small_url ?? images.small : images.small,
    attributes: {
      ...priorAttributes,
      oracle_id: card.oracle_id ?? null,
      scryfall_normal_image_url: images.normal,
      scryfall_small_image_url: images.small,
      scryfall_data: card,
      scryfall_imported_at: new Date().toISOString()
    }
  }
}

export async function importScryfallSet(requestedCode: string, options: ImportOptions): Promise<SetImportSummary> {
  const fetcher = options.fetcher ?? fetch
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const logger = options.logger ?? console
  const setCode = normalizeScryfallSetCode(requestedCode)
  if (setCode !== requestedCode.trim().toLowerCase()) logger.info(`Using Scryfall set code ${setCode} for ${requestedCode}`)

  const set = await getJson<ScryfallSet>(`${SCRYFALL_API}/sets/${encodeURIComponent(setCode)}`, fetcher)
  await wait(REQUEST_INTERVAL_MS)
  const cards: ScryfallCard[] = []
  let pageUrl: string | undefined = `${SCRYFALL_API}/cards/search?order=set&unique=prints&q=${encodeURIComponent(`e:${set.code}`)}`
  while (pageUrl) {
    const page: ScryfallList = await getJson<ScryfallList>(pageUrl, fetcher)
    cards.push(...page.data)
    pageUrl = page.has_more ? page.next_page : undefined
    if (pageUrl) await wait(REQUEST_INTERVAL_MS)
  }

  const game = await options.store.ensureMagicGame()
  const storedSet = await options.store.upsertSet(game.id, set)
  const existing = await options.store.listPrintings(storedSet.id)
  const existingByExternalId = new Map(existing.filter(item => item.external_id).map(item => [item.external_id as string, item]))
  let created = 0
  let updated = 0
  for (const card of cards) {
    const current = existingByExternalId.get(card.id)
    const data = printingData(card, game.id, storedSet.id, current)
    if (current) { await options.store.updatePrinting(current.id, data); updated++ }
    else { await options.store.createPrinting(data); created++ }
  }
  return { requestedCode, setCode: set.code, setName: set.name, discovered: cards.length, created, updated }
}
