import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { rankBestSellers, type SalesOrder } from "../../../../lib/hottest-cards"
export async function GET(req: MedusaStoreRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const channelIds = req.publishable_key_context?.sales_channel_ids ?? []
  if (!channelIds.length) { res.json({ variantIds: [], since }); return }
  const orders: SalesOrder[] = []
  for (let skip = 0; ; skip += 500) {
    const { data } = await query.graph({ entity: "order", fields: ["status", "items.variant_id", "items.quantity", "items.detail.return_received_quantity", "payment_collections.status"], filters: { sales_channel_id: channelIds, created_at: { $gte: since }, status: { $ne: "canceled" } }, pagination: { skip, take: 500, order: { id: "ASC" } } })
    orders.push(...data as unknown as SalesOrder[])
    if (data.length < 500) break
  }
  res.setHeader("Cache-Control", "private, max-age=60")
  res.json({ variantIds: rankBestSellers(orders), since })
}
