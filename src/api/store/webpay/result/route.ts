import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CheckoutError } from "../../../../lib/test-checkout"
import { resolveWebpayReturn } from "../../../../lib/webpay-orders"

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : undefined)

/**
 * The return page sends what Transbank put in the address (token_ws, or TBK_TOKEN / TBK_ORDEN_COMPRA / TBK_ID_SESION).
 * No sign-in is needed: the one-time token is the proof, and Transbank itself decides whether the payment was approved.
 */
export async function POST(req: MedusaRequest<Record<string, unknown>>, res: MedusaResponse) {
  try {
    const body = req.body ?? {}
    res.setHeader("Cache-Control", "no-store")
    res.json(await resolveWebpayReturn(req.scope, { token_ws: text(body.token_ws), TBK_TOKEN: text(body.TBK_TOKEN), TBK_ORDEN_COMPRA: text(body.TBK_ORDEN_COMPRA), TBK_ID_SESION: text(body.TBK_ID_SESION) }))
  } catch (error) {
    if (error instanceof CheckoutError) return res.status(error.status).json({ code: error.code, message: error.message })
    return res.status(500).json({ code: "webpay_failed", message: "We could not confirm the payment. Please reload this page." })
  }
}
