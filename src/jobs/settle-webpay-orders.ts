import { settleStaleWebpayOrders } from "../lib/webpay-orders"

/** Every 10 minutes: Webpay orders whose shopper never came back are confirmed if they paid, or released (stock back) after 30 minutes. */
export default async function settleWebpayOrders(container: any) {
  const logger = container.resolve("logger")
  try {
    const result = await settleStaleWebpayOrders(container)
    if (result.paid || result.released || result.skipped) logger.info(`[webpay] settled stale orders: ${result.paid} paid, ${result.released} released, ${result.skipped} retried later`)
  } catch (error) { logger.warn(`[webpay] stale order check failed: ${(error as Error).message}`) }
}
export const config = { name: "settle-webpay-orders", schedule: "*/10 * * * *" }
