import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { normalizeSections } from "./storefront-sections"
import { storeWarehouseIds } from "./store-warehouse-scope"
import { orderSummaryEmail } from "./order-email"
import { invalidateCatalogueCache } from "./catalogue-cache"

export type CheckoutLine = {
  line_id: string; variant_id: string; title: string; quantity: number
  sellable: boolean; manage_inventory: boolean; links: { inventory_item_id: string; required_quantity: number }[]
}
export type StockLevel = { inventory_item_id: string; location_id: string; available: number }
export type StockProblem = { variant_id: string; title: string; requested: number; available: number }
export type Reservation = { inventory_item_id: string; location_id: string; quantity: number; variant_id: string }

/**
 * Pure planning step: can every line be served from the stock currently available, and from which locations?
 * Lines that share an inventory item compete for the same units.
 */
export function planStock(lines: CheckoutLine[], levels: StockLevel[]) {
  const left = new Map<string, number>()
  for (const level of levels) left.set(`${level.inventory_item_id}|${level.location_id}`, Math.max(0, level.available))
  const problems: StockProblem[] = []
  const reservations: Reservation[] = []
  for (const line of lines) {
    if (!line.sellable) { problems.push({ variant_id: line.variant_id, title: line.title, requested: line.quantity, available: 0 }); continue }
    if (!line.manage_inventory || !line.links.length) continue
    const totals = line.links.map(link => {
      const total = levels.filter(level => level.inventory_item_id === link.inventory_item_id).reduce((sum, level) => sum + (left.get(`${level.inventory_item_id}|${level.location_id}`) ?? 0), 0)
      return Math.floor(total / Math.max(1, link.required_quantity))
    })
    const available = Math.min(...totals)
    if (available < line.quantity) { problems.push({ variant_id: line.variant_id, title: line.title, requested: line.quantity, available }); continue }
    for (const link of line.links) {
      let remaining = line.quantity * Math.max(1, link.required_quantity)
      const candidates = levels.filter(level => level.inventory_item_id === link.inventory_item_id)
        .sort((a, b) => (left.get(`${b.inventory_item_id}|${b.location_id}`) ?? 0) - (left.get(`${a.inventory_item_id}|${a.location_id}`) ?? 0))
      for (const level of candidates) {
        const key = `${level.inventory_item_id}|${level.location_id}`
        const take = Math.min(remaining, left.get(key) ?? 0)
        if (take <= 0) continue
        left.set(key, (left.get(key) ?? 0) - take)
        reservations.push({ inventory_item_id: level.inventory_item_id, location_id: level.location_id, quantity: take, variant_id: line.variant_id })
        remaining -= take
        if (remaining === 0) break
      }
    }
  }
  return { problems, reservations }
}

export class CheckoutError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message) }
}

export async function testCheckoutEnabled(scope: any) {
  const [store] = await scope.resolve(Modules.STORE).listStores({}, { take: 1 })
  return normalizeSections(store?.metadata?.storefront_sections).testCheckout === true
}

async function readCheckoutState(req: any, cart: any, stockScope: { channel: string; locations: string[] }) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const variantIds = [...new Set(cart.items.map((item: any) => item.variant_id).filter(Boolean))]
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "manage_inventory", "product.title", "product.status", "product.sales_channels.id", "inventory_items.inventory_item_id", "inventory_items.required_quantity"],
    filters: { id: variantIds },
  })
  const lines: CheckoutLine[] = cart.items.map((item: any) => {
    const variant = variants.find((v: any) => v.id === item.variant_id)
    return {
      line_id: item.id, variant_id: item.variant_id, title: item.title || variant?.product?.title || "Product", quantity: Number(item.quantity),
      sellable: Boolean(variant && variant.product?.status === "published" && variant.product.sales_channels?.some((c: any) => c.id === stockScope.channel)),
      manage_inventory: variant?.manage_inventory !== false,
      links: (variant?.inventory_items || []).map((link: any) => ({ inventory_item_id: link.inventory_item_id, required_quantity: Number(link.required_quantity ?? 1) })),
    }
  })
  const itemIds = [...new Set(lines.flatMap(line => line.links.map(link => link.inventory_item_id)))]
  const levels: StockLevel[] = []
  if (itemIds.length && stockScope.locations.length) {
    for (let skip = 0; ; skip += 1000) {
      const batch = await req.scope.resolve(Modules.INVENTORY).listInventoryLevels({ inventory_item_id: itemIds, location_id: stockScope.locations }, { take: 1000, skip })
      levels.push(...batch.map((level: any) => ({ inventory_item_id: level.inventory_item_id, location_id: level.location_id, available: Number(level.stocked_quantity) - Number(level.reserved_quantity) })))
      if (batch.length < 1000) break
    }
  }
  return { lines, levels, itemIds }
}

export type Contact = { name?: string; phone?: string; address?: string; city?: string; notes?: string }
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "")

export async function placeTestOrder(req: any, customerId: string, body: { cart_id?: unknown; contact?: Contact; locale?: unknown }) {
  if (!(await testCheckoutEnabled(req.scope))) throw new CheckoutError(403, "test_checkout_disabled", "Test checkout is turned off.")
  if (typeof body.cart_id !== "string" || !body.cart_id) throw new CheckoutError(400, "cart_required", "Cart is required.")
  const carts = req.scope.resolve(Modules.CART)
  let cart
  try { cart = await carts.retrieveCart(body.cart_id, { relations: ["items"] }) } catch { throw new CheckoutError(404, "cart_not_found", "Cart not found.") }
  if (cart.customer_id !== customerId) throw new CheckoutError(403, "cart_not_yours", "This cart belongs to another account.")
  if (cart.completed_at) throw new CheckoutError(409, "cart_completed", "This cart was already ordered.")
  if (!cart.items?.length) throw new CheckoutError(400, "cart_empty", "The cart is empty.")
  const stockScope = await storeWarehouseIds(req)
  if (cart.sales_channel_id && cart.sales_channel_id !== stockScope.channel) throw new CheckoutError(403, "cart_other_store", "This cart belongs to a different store.")

  const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)
  const locale = body.locale === "en" ? "en" : "es"
  const contact = body.contact ?? {}
  const name = clean(contact.name, 120), phone = clean(contact.phone, 40), address = clean(contact.address, 200), city = clean(contact.city, 80), notes = clean(contact.notes, 500)

  const first = await readCheckoutState(req, cart, stockScope)
  const precheck = planStock(first.lines, first.levels)
  if (precheck.problems.length) throw new CheckoutError(409, "insufficient_stock", "Some products are no longer available.", { problems: precheck.problems })

  // Re-check and reserve under the same lock the CMS uses for stock changes, so two shoppers cannot take the last unit.
  const created = await req.scope.resolve(Modules.LOCKING).execute(first.itemIds.map(id => `cms-inventory:${id}`), async () => {
    const state = await readCheckoutState(req, cart, stockScope)
    const plan = planStock(state.lines, state.levels)
    if (plan.problems.length) throw new CheckoutError(409, "insufficient_stock", "Some products are no longer available.", { problems: plan.problems })
    const { result: order } = await createOrderWorkflow(req.scope).run({
      input: {
        region_id: cart.region_id, sales_channel_id: stockScope.channel, customer_id: customerId, email: customer.email, currency_code: cart.currency_code,
        status: "pending",
        items: cart.items.map((item: any) => ({ variant_id: item.variant_id, quantity: Number(item.quantity), unit_price: Number(item.unit_price), title: item.title })),
        ...(address || phone || name ? { shipping_address: { first_name: name || customer.first_name || "", last_name: customer.last_name || "", address_1: address, city, phone, country_code: "cl" } } : {}),
        metadata: { test_order: true, payment_status: "not_paid", payment_updated_at: new Date().toISOString(), customer_notes: notes || undefined, contact_phone: phone || undefined, contact_name: name || undefined },
      },
    } as any)
    const { data: [full] } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "order", fields: ["id", "display_id", "email", "currency_code", "total", "subtotal", "created_at", "items.id", "items.title", "items.variant_id", "items.quantity", "items.unit_price", "items.total", "items.thumbnail"], filters: { id: order.id },
    })
    const lineByVariant = new Map<string, string>(full.items.map((item: any) => [item.variant_id, item.id]))
    if (plan.reservations.length) {
      await req.scope.resolve(Modules.INVENTORY).createReservationItems(plan.reservations.map(reservation => ({
        inventory_item_id: reservation.inventory_item_id, location_id: reservation.location_id, quantity: reservation.quantity, line_item_id: lineByVariant.get(reservation.variant_id),
      })))
    }
    await carts.updateCarts([{ id: cart.id, completed_at: new Date() }])
    return full
  })

  invalidateCatalogueCache()
  let emailSent = false
  try {
    const message = orderSummaryEmail(locale, { ...created, payment_status: "not_paid", customer_name: name || customer.first_name || "", notes })
    await req.scope.resolve(Modules.NOTIFICATION).createNotifications({ to: customer.email, channel: "email", template: "order-summary", data: message })
    emailSent = true
  } catch { /* the order exists; a failed email must not undo it */ }
  return { order: { ...created, payment_status: "not_paid" as const }, email_sent: emailSent }
}
