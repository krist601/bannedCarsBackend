export type SalesOrder = {
  status: string; payment_collections?: { status: string }[];
  items?: { variant_id?: string | null; quantity: number; detail?: { return_received_quantity?: number | null } | null }[]
}
export function rankBestSellers(orders: SalesOrder[]): string[] {
  const units = new Map<string, number>()
  for (const order of orders) {
    if (order.status === "canceled" || !order.payment_collections?.some(payment => payment.status === "completed")) continue
    for (const item of order.items ?? []) {
      const quantity = Math.max(0, Number(item.quantity) - Number(item.detail?.return_received_quantity ?? 0))
      if (item.variant_id && Number.isFinite(quantity) && quantity > 0) units.set(item.variant_id, (units.get(item.variant_id) ?? 0) + quantity)
    }
  }
  return [...units].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
}
