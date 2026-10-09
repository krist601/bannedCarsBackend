import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { visibleFilterSets } from "../../../../lib/cms-visible-sets"
import { latestSetCodes } from "../../../../lib/set-directory"
import { pageVisibleSets } from "../../../../lib/flat-set-page"
import { readMagicSets } from "../../../../lib/set-directory-store"
import { cachedCatalogue, invalidateCatalogueCache } from "../../../../lib/catalogue-cache"
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = req.query.limit === undefined ? 10 : Number(req.query.limit)
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 || !Number.isInteger(offset) || offset < 0 || (req.query.q !== undefined && typeof req.query.q !== "string")) {
    res.status(400).json({ message: "Use limit 1–10, a non-negative offset, and a string q parameter" }); return
  }
  const directory = await cachedCatalogue("magic-sets", () => readMagicSets(req.scope))
  if (!directory.length) { invalidateCatalogueCache(); res.status(503).json({ message: "The set directory is being prepared. Please try again shortly." }); return }
  const page = pageVisibleSets(directory, { limit, offset, query: req.query.q as string | undefined })
  res.json({ ...page, latestSetCodes: latestSetCodes(visibleFilterSets(directory)) })
}
