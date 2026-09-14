const SCRYFALL_IMAGE_HOST = "cards.scryfall.io"
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

export type CardPrintingImageRecord = {
  id: string
  external_id?: string | null
  image_source?: string | null
  image_url?: string | null
  image_small_url?: string | null
  attributes?: Record<string, unknown> | null
}

export type StoredFile = { id: string; url: string }
export type ImageStorage = {
  upload(input: { filename: string; mimeType: string; content: string }): Promise<StoredFile>
  remove?(ids: string[]): Promise<void>
}
export type CardPrintingWriter = {
  update(id: string, data: Record<string, unknown>): Promise<void>
}
export type ImageSyncLogger = Pick<Console, "info" | "warn" | "error">

type SyncOptions = {
  storage: ImageStorage
  writer: CardPrintingWriter
  fetcher?: typeof fetch
  logger?: ImageSyncLogger
  dryRun?: boolean
  onStored?: (printing: CardPrintingImageRecord, imageUrl: string) => Promise<void>
}

export type ImageSyncSummary = { discovered: number; uploaded: number; skipped: number; failed: number }

function sourceUrl(printing: CardPrintingImageRecord, size: "normal" | "small") {
  const attributes = printing.attributes ?? {}
  const preserved = attributes[`scryfall_${size}_image_url`]
  if (typeof preserved === "string") return preserved
  const current = size === "normal" ? printing.image_url : printing.image_small_url
  return typeof current === "string" ? current : null
}

function assertScryfallImageUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== SCRYFALL_IMAGE_HOST) {
    throw new Error(`Refusing non-Scryfall image URL: ${url.hostname}`)
  }
  return url
}

function extension(mimeType: string) {
  if (mimeType === "image/png") return "png"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/jpeg") return "jpg"
  throw new Error(`Unsupported image type: ${mimeType}`)
}

async function download(urlValue: string, fetcher: typeof fetch) {
  const url = assertScryfallImageUrl(urlValue)
  const response = await fetcher(url, {
    headers: {
      "User-Agent": process.env.SCRYFALL_USER_AGENT || "BannedCards/0.1 (card-image-sync)",
      Accept: "image/avif,image/webp,image/jpeg,image/png"
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}`)
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0].toLowerCase() ?? ""
  extension(mimeType)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Invalid image size: ${bytes.length} bytes`)
  return { mimeType, content: bytes.toString("base64") }
}

export async function syncCardImages(printings: CardPrintingImageRecord[], options: SyncOptions): Promise<ImageSyncSummary> {
  const fetcher = options.fetcher ?? fetch
  const logger = options.logger ?? console
  const summary: ImageSyncSummary = { discovered: printings.length, uploaded: 0, skipped: 0, failed: 0 }

  for (const printing of printings) {
    const attributes = printing.attributes ?? {}
    const storedNormal = attributes.image_storage_url
    const storedSmall = attributes.image_small_storage_url
    if (typeof storedNormal === "string" && typeof storedSmall === "string") {
      await options.onStored?.(printing, storedNormal)
      summary.skipped++
      continue
    }

    const normalSource = sourceUrl(printing, "normal")
    const smallSource = sourceUrl(printing, "small") ?? normalSource
    if (printing.image_source !== "scryfall" || !printing.external_id || !normalSource || !smallSource) {
      logger.warn(`Skipping ${printing.id}: incomplete Scryfall image metadata`)
      summary.skipped++
      continue
    }
    if (options.dryRun) {
      logger.info(`Would store images for ${printing.id}`)
      summary.skipped++
      continue
    }

    const uploadedIds: string[] = []
    let databaseUpdated = false
    try {
      const normal = await download(normalSource, fetcher)
      const storedNormalFile = await options.storage.upload({
        filename: `cards/scryfall/${printing.external_id}-normal.${extension(normal.mimeType)}`,
        ...normal
      })
      uploadedIds.push(storedNormalFile.id)
      let storedSmallFile = storedNormalFile
      if (smallSource !== normalSource) {
        const small = await download(smallSource, fetcher)
        storedSmallFile = await options.storage.upload({
          filename: `cards/scryfall/${printing.external_id}-small.${extension(small.mimeType)}`,
          ...small
        })
        uploadedIds.push(storedSmallFile.id)
      }
      const nextAttributes = {
        ...attributes,
        scryfall_normal_image_url: normalSource,
        scryfall_small_image_url: smallSource,
        image_storage_id: storedNormalFile.id,
        image_storage_url: storedNormalFile.url,
        image_small_storage_id: storedSmallFile.id,
        image_small_storage_url: storedSmallFile.url,
        image_synced_at: new Date().toISOString()
      }
      await options.writer.update(printing.id, {
        image_url: storedNormalFile.url,
        image_small_url: storedSmallFile.url,
        attributes: nextAttributes
      })
      databaseUpdated = true
      await options.onStored?.(printing, storedNormalFile.url)
      summary.uploaded++
      logger.info(`Stored images for ${printing.id}`)
    } catch (error) {
      if (!databaseUpdated && uploadedIds.length && options.storage.remove) {
        try { await options.storage.remove(uploadedIds) }
        catch (cleanupError) { logger.warn(`Could not remove orphan images for ${printing.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`) }
      }
      summary.failed++
      logger.error(`Failed ${printing.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return summary
}
