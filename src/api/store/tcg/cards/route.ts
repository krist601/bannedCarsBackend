import { cataloguePage } from "../../../../lib/catalogue-page"
import { scopeCardListings, storeWarehouseIds } from "../../../../lib/store-warehouse-scope"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { projectCardCatalogue, type CatalogueListing, type CataloguePrinting, type CatalogueSet } from "../../../../lib/card-catalogue-projection"

type TcgCatalogService = {
  listAndCountCardPrintings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[CataloguePrinting[], number]>
  listCardSets(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<CatalogueSet[]>
  listCardListings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<CatalogueListing[]>
}

function integerQuery(value: unknown, fallback: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const requestedLimit = integerQuery(req.query.limit, 100)
  const offset = integerQuery(req.query.offset, 0)
  if (requestedLimit === null || requestedLimit < 1 || offset === null) {
    res.status(400).json({ message: "limit must be positive and offset must be non-negative" })
    return
  }
  const limit = Math.min(requestedLimit, 100)
  const catalog = req.scope.resolve("tcgCatalog") as TcgCatalogService
  let stockScope;
  try { stockScope=await storeWarehouseIds(req); }
  catch(e) { return res.status(403).json({message:(e as Error).message}); }
  if (req.query.grouped === "true") {
    const showOutOfStock = req.query.showOutOfStock
    if (showOutOfStock !== undefined && showOutOfStock !== "true" && showOutOfStock !== "false") {
      res.status(400).json({ message: "showOutOfStock must be true or false" }); return
    }
    const sort = req.query.sort
    if (sort !== undefined && sort !== "added") { res.status(400).json({ message: "Invalid sort" }); return }
    const q = req.query.q
    const sets = req.query.sets
    const ranked = req.query.ranked
    if ([q, sets, ranked].some(value => value !== undefined && typeof value !== "string")) {
      res.status(400).json({ message: "Invalid catalogue filters" }); return
    }
    const all: CataloguePrinting[] = []
    for (let skip = 0; ; skip += 500) {
      const [batch] = await catalog.listAndCountCardPrintings({}, { skip, take: 500, order: { id: "ASC" } })
      all.push(...batch); if (batch.length < 500) break
    }
    const projected: ReturnType<typeof projectCardCatalogue> = []
    for (let start = 0; start < all.length; start += 100) {
      const batch = all.slice(start, start + 100)
      const sets = await catalog.listCardSets({ id: [...new Set(batch.map(item => item.set_id))] }, { take: 100 })
      const listings: CatalogueListing[] = []
      for (let skip = 0; ; skip += 1000) {
        const rows = await catalog.listCardListings({ printing_id: batch.map(item => item.id) }, { skip, take: 1000, order: { id: "ASC" } })
        listings.push(...rows); if (rows.length < 1000) break
      }
      projected.push(...projectCardCatalogue(batch, sets, await scopeCardListings(req,listings,stockScope)))
    }
    res.json(cataloguePage(projected, { offset, limit, sort: sort as "added" | undefined, showOutOfStock: showOutOfStock !== "false", q: q as string | undefined, sets: sets === undefined ? undefined : String(sets).split(","), rankedIds: ranked === undefined ? undefined : String(ranked).split(",") }))
    return
  }
  const [printings, count] = await catalog.listAndCountCardPrintings({}, {
    skip: offset,
    take: limit,
    order: { name: "ASC", collector_number: "ASC" }
  })
  const printingIds = printings.map(printing => printing.id)
  const [sets, listings] = await Promise.all([
    printings.length ? catalog.listCardSets({ id: [...new Set(printings.map(printing => printing.set_id))] }, { take: 100 }) : Promise.resolve([]),
    printingIds.length ? catalog.listCardListings({ printing_id: printingIds }, { take: 1000 }) : Promise.resolve([])
  ])
  res.json({
    cards: projectCardCatalogue(printings, sets, await scopeCardListings(req,listings,stockScope)),
    count,
    offset,
    limit
  })
}
