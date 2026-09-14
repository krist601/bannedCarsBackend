import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { syncCardImages, type CardPrintingImageRecord } from "../lib/card-image-sync"

type TcgCatalogService = {
  listCardPrintings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<CardPrintingImageRecord[]>
  updateCardPrintings(data: Record<string, unknown>): Promise<unknown>
  listCardListings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<{ product_id?: string | null }[]>
}
type FileService = {
  createFiles(data: { filename: string; mimeType: string; content: string; access: "public" }): Promise<{ id: string; url: string }>
  deleteFiles(ids: string[]): Promise<void>
}

export default async function syncCardImagesScript({ container, args }: ExecArgs) {
  const catalog = container.resolve("tcgCatalog") as TcgCatalogService
  const files = container.resolve(Modules.FILE) as FileService
  const dryRun = args.includes("dry-run") || args.includes("--dry-run")
  const limitArgument = args.find(value => value.startsWith("limit=") || value.startsWith("--limit="))
  const limit = limitArgument ? Number(limitArgument.split("=", 2)[1]) : Infinity
  if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) throw new Error("limit must be a positive integer")

  const printings: CardPrintingImageRecord[] = []
  for (let skip = 0; printings.length < limit; skip += 100) {
    const page = await catalog.listCardPrintings({}, { skip, take: Math.min(100, limit - printings.length) })
    printings.push(...page)
    if (page.length < 100) break
  }

  const summary = await syncCardImages(printings, {
    dryRun,
    storage: {
      upload: input => files.createFiles({ ...input, access: "public" }),
      remove: ids => files.deleteFiles(ids)
    },
    writer: {
      update: async (id, data) => { await catalog.updateCardPrintings({ id, ...data }) }
    },
    onStored: dryRun ? undefined : async (printing, imageUrl) => {
      const listings = await catalog.listCardListings({ printing_id: printing.id }, { select: ["product_id"] })
      const productIds = [...new Set(listings.map(listing => listing.product_id).filter((id): id is string => Boolean(id)))]
      if (productIds.length) {
        await updateProductsWorkflow(container).run({
          input: { products: productIds.map(id => ({ id, thumbnail: imageUrl })) }
        })
      }
    }
  })

  console.log(`Card image sync: ${summary.uploaded} uploaded, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.discovered} discovered`)
  if (summary.failed) throw new Error(`${summary.failed} card image(s) failed to synchronize`)
}
