import { randomUUID } from "node:crypto"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CheckoutError, createCheckoutOrder, type Contact } from "./test-checkout"
import { WebpayClient, WebpayError, buyOrderOf, isApproved, parseWebpayReturn, webpayConfig, type WebpayResult } from "./webpay"
import { orderSummaryEmail, storeOrderEmail, type Delivery, type TaxDocument } from "./order-email"
import { invalidateCatalogueCache } from "./catalogue-cache"
import { siteUrl } from "./email-layout"

/** How long an unpaid Webpay order keeps its stock reserved. */
export const WEBPAY_HOLD_MINUTES = 30

const ORDER_FIELDS = ["id", "display_id", "email", "currency_code", "total", "subtotal", "created_at", "metadata", "shipping_address.*", "items.id", "items.title", "items.variant_id", "items.quantity", "items.unit_price", "items.thumbnail"]

type StoredStatus = "pending" | "initiated" | "approved" | "failed" | "aborted" | "expired" | "review"

/** Delivery, document and notes saved on the order at checkout, rebuilt for the emails. */
export function emailPartsFromOrder(order: any) {
  const m = order.metadata ?? {}, a = order.shipping_address ?? {}
  const document: TaxDocument | undefined = m.document_type ? { type: m.document_type, rut: String(m.document_rut ?? ""), ...(m.company ? { company: m.company } : {}) } : undefined
  const name = String(m.contact_name || [a.first_name, a.last_name].filter(Boolean).join(" "))
  const delivery: Delivery | undefined = m.document_type ? { name, phone: m.contact_phone || a.phone || undefined, address: String(a.address_1 ?? ""), address2: a.address_2 || undefined, comuna: String(a.city || m.delivery_comuna || ""), region: a.province || m.delivery_region || undefined, branch: m.starken_branch || undefined, shipping: "starken" } : undefined
  return { document, delivery, notes: String(m.customer_notes ?? ""), customerName: String(m.customer_first_name || a.first_name || ""), fullName: name }
}

/** What the storefront needs to show the result page. */
export function orderView(order: any) {
  const parts = emailPartsFromOrder(order)
  return {
    id: order.id, display_id: order.display_id, total: Number(order.total), currency_code: order.currency_code,
    payment_status: order.metadata?.payment_status === "paid" ? "paid" : "not_paid",
    items: (order.items ?? []).map((item: any) => ({ title: item.title, quantity: Number(item.quantity), unit_price: Number(item.unit_price), thumbnail: item.thumbnail ?? null })),
    delivery: parts.delivery ?? null, document: parts.document ?? null, notes: parts.notes,
  }
}

async function loadOrder(scope: any, id: string) {
  const { data: [order] } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "order", fields: ORDER_FIELDS, filters: { id } })
  if (!order) throw new CheckoutError(404, "order_not_found", "Order not found.")
  return order
}

async function mergeMetadata(scope: any, orderId: string, extra: Record<string, unknown>) {
  const service = scope.resolve(Modules.ORDER)
  const current = await service.retrieveOrder(orderId, { select: ["id", "metadata"] })
  await service.updateOrders(orderId, { metadata: { ...(current.metadata ?? {}), ...extra } })
}

/** Webpay orders from the last days that may still be waiting for the shopper. Small by nature. */
async function recentWebpayOrders(scope: any, days = 3) {
  const since = new Date(Date.now() - days * 86_400_000)
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order", fields: ["id", "display_id", "metadata", "created_at"], filters: { created_at: { $gte: since } }, pagination: { take: 500, order: { created_at: "DESC" } },
  })
  return (data as any[]).filter(order => order.metadata?.payment_method === "webpay")
}

/** Gives the reserved stock back and closes the order. Nothing was charged. */
export async function releaseWebpayOrder(scope: any, orderId: string, status: Extract<StoredStatus, "failed" | "aborted" | "expired">) {
  const order = await loadOrder(scope, orderId)
  await scope.resolve(Modules.INVENTORY).deleteReservationItemsByLineItem((order.items ?? []).map((item: any) => item.id))
  try { await scope.resolve(Modules.ORDER).cancel(orderId) } catch { /* the order stays pending; the metadata below marks it closed */ }
  await mergeMetadata(scope, orderId, { webpay_status: status, webpay_closed_at: new Date().toISOString(), payment_status: "not_paid" })
  invalidateCatalogueCache()
}

/** Confirms a payment; a second commit for the same token is refused by Transbank, so fall back to the transaction status. */
async function commitOrStatus(client: WebpayClient, token: string): Promise<WebpayResult> {
  try { return await client.commit(token) }
  catch (error) {
    if (error instanceof WebpayError && !error.httpStatus) throw error // Webpay unreachable: do not guess
    return await client.status(token)
  }
}

/** The first step: create the order (stock reserved) and ask Transbank for a payment link. */
export async function startWebpayPayment(req: any, customerId: string, body: { cart_id?: unknown; contact?: Contact; locale?: unknown }, fetcher?: typeof fetch) {
  // A new attempt for the same cart frees the stock held by the previous one.
  if (typeof body.cart_id === "string") {
    for (const prior of await recentWebpayOrders(req.scope)) {
      if (prior.metadata?.cart_id === body.cart_id && ["pending", "initiated"].includes(prior.metadata?.webpay_status)) await releaseWebpayOrder(req.scope, prior.id, "aborted").catch(() => undefined)
    }
  }
  const placed = await createCheckoutOrder(req, customerId, body, "webpay")
  const order = placed.created
  const config = webpayConfig()
  const client = new WebpayClient(config, fetcher)
  const sessionId = randomUUID()
  let transaction
  try {
    transaction = await client.create({ buyOrder: buyOrderOf(order.display_id), sessionId, amount: Math.round(Number(order.total)), returnUrl: `${siteUrl()}/webpay/retorno` })
  } catch (error) {
    await releaseWebpayOrder(req.scope, order.id, "failed").catch(() => undefined)
    throw new CheckoutError(502, "webpay_unavailable", error instanceof WebpayError && error.httpStatus ? "Webpay rejected the payment request. Nothing was charged." : "Webpay is not available right now. Nothing was charged.")
  }
  await mergeMetadata(req.scope, order.id, { webpay_token: transaction.token, webpay_buy_order: buyOrderOf(order.display_id), webpay_session_id: sessionId, webpay_status: "initiated", webpay_started_at: new Date().toISOString(), webpay_environment: config.environment })
  return { url: transaction.url, token: transaction.token, order_id: order.id, display_id: order.display_id }
}

async function sendPaidEmails(scope: any, order: any, result: WebpayResult) {
  const parts = emailPartsFromOrder(order)
  const locale = order.metadata?.locale === "en" ? "en" : "es"
  const test = (order.metadata?.webpay_environment ?? "integration") !== "production"
  const payment = { method: "webpay" as const, card: result.card_detail?.card_number, authCode: result.authorization_code, installments: result.installments_number }
  let sent = false
  try {
    const message = orderSummaryEmail(locale, { ...order, total: Number(order.total), payment_status: "paid", customer_name: parts.customerName, notes: parts.notes, delivery: parts.delivery, document: parts.document, payment, test })
    await scope.resolve(Modules.NOTIFICATION).createNotifications({ to: order.email, channel: "email", template: "order-summary", data: message })
    sent = true
  } catch { /* the order is paid either way */ }
  try {
    const message = storeOrderEmail({ ...order, total: Number(order.total), payment_status: "paid", customer_name: parts.fullName, customer_email: order.email, notes: parts.notes, delivery: parts.delivery, document: parts.document, payment, test })
    await scope.resolve(Modules.NOTIFICATION).createNotifications({ to: process.env.STORE_ORDER_EMAIL || "compras@bannedcards.cl", channel: "email", template: "store-order", data: message })
  } catch { /* best effort */ }
  return sent
}

async function finalizePaid(scope: any, orderId: string, result: WebpayResult) {
  await mergeMetadata(scope, orderId, {
    payment_status: "paid", payment_updated_at: new Date().toISOString(), webpay_status: "approved",
    webpay: { authorization_code: result.authorization_code, payment_type_code: result.payment_type_code, installments: result.installments_number ?? 0, card_last4: String(result.card_detail?.card_number ?? "").slice(-4), transaction_date: result.transaction_date, amount: result.amount },
  })
  const order = await loadOrder(scope, orderId)
  const cartId = order.metadata?.cart_id
  if (cartId) { try { await scope.resolve(Modules.CART).updateCarts([{ id: cartId, completed_at: new Date() }]) } catch { /* the order is paid either way */ } }
  const emailSent = await sendPaidEmails(scope, order, result)
  await mergeMetadata(scope, orderId, { webpay_email_sent: emailSent })
  return { order: await loadOrder(scope, orderId), emailSent }
}

export type WebpayOutcome =
  | { status: "approved"; order: ReturnType<typeof orderView>; email_sent: boolean; payment: { card_last4: string; authorization_code: string; installments: number; environment: string } }
  | { status: "rejected" | "aborted" | "review" | "unknown"; order?: ReturnType<typeof orderView>; message?: string }

function approvedOutcome(order: any, emailSent: boolean): WebpayOutcome {
  const w = order.metadata?.webpay ?? {}
  return { status: "approved", order: orderView(order), email_sent: emailSent, payment: { card_last4: String(w.card_last4 ?? ""), authorization_code: String(w.authorization_code ?? ""), installments: Number(w.installments ?? 0), environment: String(order.metadata?.webpay_environment ?? "integration") } }
}

function storedOutcome(order: any): WebpayOutcome | null {
  const status = order.metadata?.webpay_status as StoredStatus | undefined
  if (status === "approved") return approvedOutcome(order, order.metadata?.webpay_email_sent === true)
  if (status === "aborted") return { status: "aborted", order: orderView(order) }
  if (status === "failed" || status === "expired") return { status: "rejected", order: orderView(order) }
  if (status === "review") return { status: "review", order: orderView(order) }
  return null
}

/** The shopper came back from Webpay: confirm the payment with Transbank (once), then mark the order paid or give the stock back. */
export async function confirmWebpayPayment(scope: any, token: string, fetcher?: typeof fetch): Promise<WebpayOutcome> {
  const known = (await recentWebpayOrders(scope)).find(order => order.metadata?.webpay_token === token)
  if (!known) return { status: "unknown", message: "We could not find this payment." }
  return scope.resolve(Modules.LOCKING).execute(`webpay:${known.id}`, async (): Promise<WebpayOutcome> => {
    const fresh = await loadOrder(scope, known.id)
    const stored = storedOutcome(fresh)
    if (stored) return stored
    const client = new WebpayClient(webpayConfig(), fetcher)
    let result: WebpayResult
    try { result = await commitOrStatus(client, token) }
    catch { throw new CheckoutError(502, "webpay_unavailable", "We could not confirm the payment with Webpay yet. Please reload this page in a moment.") }
    if (isApproved(result)) {
      if (Number(result.amount) !== Math.round(Number(fresh.total))) {
        await mergeMetadata(scope, fresh.id, { webpay_status: "review", webpay_amount_mismatch: result.amount })
        return { status: "review", order: orderView(fresh), message: "The paid amount does not match the order. We will contact you." }
      }
      const done = await finalizePaid(scope, fresh.id, result)
      return approvedOutcome(done.order, done.emailSent)
    }
    await releaseWebpayOrder(scope, fresh.id, "failed")
    return { status: "rejected", order: orderView(await loadOrder(scope, fresh.id)) }
  })
}

/** The shopper cancelled at the Webpay form (or it timed out): close the order and give the stock back. */
export async function abortWebpayPayment(scope: any, input: { buyOrder: string; sessionId: string }): Promise<WebpayOutcome> {
  const match = /^BC(\d{1,12})$/.exec(input.buyOrder)
  if (!match || !input.sessionId) return { status: "unknown", message: "We could not find this payment." }
  const known = (await recentWebpayOrders(scope)).find(order => order.display_id === Number(match[1]) && order.metadata?.webpay_session_id === input.sessionId)
  if (!known) return { status: "unknown", message: "We could not find this payment." }
  return scope.resolve(Modules.LOCKING).execute(`webpay:${known.id}`, async (): Promise<WebpayOutcome> => {
    const fresh = await loadOrder(scope, known.id)
    if (fresh.metadata?.webpay_status === "initiated") await releaseWebpayOrder(scope, fresh.id, "aborted")
    return storedOutcome(await loadOrder(scope, fresh.id)) ?? { status: "aborted" }
  })
}

/** One entry point for the return page: reads what Transbank sent and returns the outcome. */
export function resolveWebpayReturn(scope: any, params: Record<string, string | undefined>, fetcher?: typeof fetch): Promise<WebpayOutcome> {
  const parsed = parseWebpayReturn(params)
  if (parsed.kind === "finished") return confirmWebpayPayment(scope, parsed.token, fetcher)
  if (parsed.kind === "aborted") return abortWebpayPayment(scope, parsed)
  return Promise.resolve({ status: "unknown", message: "We could not find this payment." })
}

/**
 * Safety net for the job: orders whose shopper never came back. Transbank only finalises a payment when the store
 * commits it, so the job tries to commit: if the shopper had paid, the order is finalised (nobody is charged for a
 * cancelled order); if not (or Transbank already reversed it), the stock is released.
 */
export async function settleStaleWebpayOrders(scope: any, now = new Date(), fetcher?: typeof fetch) {
  const cutoff = now.getTime() - WEBPAY_HOLD_MINUTES * 60_000
  let paid = 0, released = 0, skipped = 0
  for (const known of await recentWebpayOrders(scope)) {
    const m = known.metadata ?? {}
    if (m.webpay_status !== "initiated" || !m.webpay_started_at || Date.parse(m.webpay_started_at) > cutoff) continue
    await scope.resolve(Modules.LOCKING).execute(`webpay:${known.id}`, async () => {
      const fresh = await loadOrder(scope, known.id)
      if (fresh.metadata?.webpay_status !== "initiated") return
      let result: WebpayResult | null = null
      try { result = await commitOrStatus(new WebpayClient(webpayConfig(), fetcher), String(m.webpay_token)) }
      catch (error) {
        // Transbank refuses a payment nobody finished (a 4xx answer); a network problem or a 5xx is retried on the next run.
        if (!(error instanceof WebpayError) || !error.httpStatus || error.httpStatus >= 500) { skipped++; return }
      }
      if (result && isApproved(result) && Number(result.amount) === Math.round(Number(fresh.total))) { await finalizePaid(scope, fresh.id, result); paid++ }
      else { await releaseWebpayOrder(scope, fresh.id, "expired"); released++ }
    })
  }
  return { paid, released, skipped }
}
