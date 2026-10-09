import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CheckoutError, placeTestOrder, testCheckoutEnabled } from "../../../lib/test-checkout"

/** Tells the storefront whether the test checkout is on (also exposed as a setting; this one is authoritative). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ enabled: await testCheckoutEnabled(req.scope) })
}

/** Places an unpaid order from the signed-in customer's cart, after re-checking stock in the database. */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, any>>, res: MedusaResponse) {
  try {
    res.json(await placeTestOrder(req, req.auth_context.actor_id, req.body ?? {}))
  } catch (error) {
    if (error instanceof CheckoutError) return res.status(error.status).json({ code: error.code, message: error.message, ...error.extra })
    return res.status(500).json({ code: "checkout_failed", message: "The order could not be placed. Nothing was charged." })
  }
}
