import type { MedusaContainer, IFileModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { readMagicSets, type SetCatalog } from "./set-directory-store"

/** Icons saved by the local file provider (http://localhost:9000/static/...) cannot be loaded by shoppers; re-upload them to the configured storage. */
const isLocalFileUrl = (value: unknown) => typeof value === "string" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(value) && process.env.FILE_STORAGE_DRIVER === "s3"
type ScryfallSet = { id: string; code: string; name: string; released_at?: string; icon_svg_uri?: string; block_code?: string; block?: string; parent_set_code?: string; set_type: string; digital: boolean }
const headers = { "User-Agent": "BannedCards/0.1 (set-directory-sync)", Accept: "application/json" }

export async function syncSetDirectory(container: MedusaContainer) {
  const catalog = container.resolve<SetCatalog>("tcgCatalog")
  const files = container.resolve<IFileModuleService>(Modules.FILE)
  const logger = container.resolve<{ info(message: string): void; warn(message: string): void }>("logger")
  const response = await fetch("https://api.scryfall.com/sets", { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Set sync failed: Scryfall HTTP ${response.status}`)
  const payload = await response.json() as { data?: ScryfallSet[]; has_more?: boolean }
  if (!Array.isArray(payload.data) || !payload.data.length || payload.has_more || payload.data.some(set => !/^[a-z0-9]{2,10}$/.test(set.code) || !set.name || !set.id)) throw new Error("Invalid or incomplete Scryfall set list")
  let [game] = await catalog.listGames({ handle: "magic" })
  if (!game) game = await catalog.createGames({ handle: "magic", name: "Magic: The Gathering", publisher: "Wizards of the Coast" })
  const existing = new Map((await readMagicSets(container)).map(set => [set.code.toLowerCase(), set]))
  let iconFailures = 0
  let processed = 0
  for (const set of payload.data) {
    const prior = existing.get(set.code)
    const metadata: Record<string, unknown> = { isVisible: true, ...prior?.metadata, scryfall_id: set.id, block_code: set.block_code ?? null, block: set.block ?? null, parent_set_code: set.parent_set_code ?? null, set_type: set.set_type, digital: set.digital, scryfall_icon_url: set.icon_svg_uri ?? null, sets_synced_at: new Date().toISOString() }
    let uploadedId: string | undefined
    if (process.env.SYNC_SET_ICONS !== "false" && set.icon_svg_uri && (!metadata.icon_storage_url || metadata.icon_source_url !== set.icon_svg_uri || isLocalFileUrl(metadata.icon_storage_url))) {
      try {
        const url = new URL(set.icon_svg_uri)
        if (url.protocol !== "https:" || url.hostname !== "svgs.scryfall.io") throw new Error("Unexpected icon source")
        await new Promise(resolve => setTimeout(resolve, 100))
        const icon = await fetch(url, { headers: { ...headers, Accept: "image/svg+xml" }, redirect: "error", signal: AbortSignal.timeout(15000) })
        if (!icon.ok || !icon.headers.get("content-type")?.includes("image/svg+xml")) throw new Error(`Invalid icon response: ${icon.status}`)
        const bytes = Buffer.from(await icon.arrayBuffer())
        if (!bytes.length || bytes.length > 512000 || !bytes.toString("utf8").includes("<svg")) throw new Error("Invalid SVG")
        const file = await files.createFiles({ filename: `sets/${set.code}.svg`, mimeType: "image/svg+xml", content: bytes.toString("base64"), access: "public" })
        uploadedId = file.id
        metadata.icon_storage_url = file.url
        metadata.icon_storage_id = file.id
        metadata.icon_source_url = set.icon_svg_uri
      } catch (error) {
        iconFailures++
        logger.warn(`Set ${set.code}: icon unavailable; retaining previous icon for retry. ${String(error)}`)
      }
    }
    try {
      const data = { game_id: game.id, code: set.code, name: set.name, released_at: set.released_at ? new Date(`${set.released_at}T00:00:00Z`) : null, metadata }
      if (prior) await catalog.updateCardSets({ id: prior.id, ...data })
      else await catalog.createCardSets(data)
    } catch (error) {
      if (uploadedId) await files.deleteFiles(uploadedId).catch(() => undefined)
      throw error
    }
    processed++
    if (processed % 100 === 0) logger.info(`Set sync progress: ${processed}/${payload.data.length}`)
    const oldId = prior?.metadata?.icon_storage_id
    if (uploadedId && typeof oldId === "string" && oldId !== uploadedId) await files.deleteFiles(oldId).catch(() => logger.warn(`Could not remove old icon for ${set.code}`))
  }
  logger.info(`Set directory synced: ${payload.data.length} sets, ${iconFailures} icons pending retry`)
  return { sets: payload.data.length, iconFailures }
}
