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
    cards: projectCardCatalogue(printings, sets, listings),
    count,
    offset,
    limit
  })
}
