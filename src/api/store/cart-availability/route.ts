import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { scopeCardListings, storeWarehouseIds } from "../../../lib/store-warehouse-scope"

/** Available quantity per variant for this store (null = stock is not tracked). Used to flag cart lines that ran out. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ids = [...new Set(String(req.query.variant_ids ?? "").split(",").map(id => id.trim()).filter(Boolean))]
  if (!ids.length || ids.length > 100 || ids.some(id => !/^variant_[A-Za-z0-9]+$/.test(id))) return res.status(400).json({ message: "Provide up to 100 variant ids." })
  try {
    const scope = await storeWarehouseIds(req)
    const rows = await scopeCardListings(req, ids.map(variant_id => ({ variant_id })), scope)
    res.json({ availability: Object.fromEntries(rows.map(row => [row.variant_id, row.quantity ?? 0])) })
  } catch (error) {
    res.status(403).json({ message: (error as Error).message })
  }
}
