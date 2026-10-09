import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CheckoutError } from "../../../../lib/test-checkout"
import { startWebpayPayment } from "../../../../lib/webpay-orders"

/** Starts a Webpay payment for the signed-in customer's cart: creates the order (stock reserved) and returns the Webpay address and token. */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, any>>, res: MedusaResponse) {
  try {
    res.json(await startWebpayPayment(req, req.auth_context.actor_id, req.body ?? {}))
  } catch (error) {
    if (error instanceof CheckoutError) return res.status(error.status).json({ code: error.code, message: error.message, ...error.extra })
    return res.status(500).json({ code: "webpay_failed", message: "The payment could not be started. Nothing was charged." })
  }
}
