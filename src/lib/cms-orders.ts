import { Modules } from "@medusajs/framework/utils"

export type PaymentState = "paid" | "not_paid"
/** Test orders carry the payment state in their metadata; real orders fall back to Medusa's own payment status. */
export function paymentStateOf(order: { metadata?: Record<string, unknown> | null; payment_status?: string | null }): PaymentState {
  const saved = order.metadata?.payment_status
  if (saved === "paid" || saved === "not_paid") return saved
  return order.payment_status === "captured" ? "paid" : "not_paid"
}

/** `order_payment`: mark an order as paid or not paid from the CMS. */
export async function setOrderPayment(req: any, res: any) {
  const { order_id, paid } = req.body ?? {}
  if (typeof order_id !== "string" || typeof paid !== "boolean") return res.status(400).json({ message: "Order and paid (true/false) are required." })
  const service = req.scope.resolve(Modules.ORDER)
  let order
  try { order = await service.retrieveOrder(order_id) } catch { return res.status(404).json({ message: "Order not found." }) }
  const state: PaymentState = paid ? "paid" : "not_paid"
  await service.updateOrders(order_id, { metadata: { ...order.metadata, payment_status: state, payment_updated_at: new Date().toISOString() } })
  res.json({ ok: true, payment_status: state })
}
