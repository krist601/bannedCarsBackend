import { syncCardKingdomPrices } from "../lib/cardkingdom-prices";
import { readPricing } from "../lib/cms-pricing-settings";

/** Daily, after MTGJSON publishes the new prices: refresh the stored Card Kingdom prices (only when that source is selected). Listing prices do not change until "Update prices" is used. */
export default async function cardKingdomPrices(container: any) {
  const logger = container.resolve("logger");
  try {
    if ((await readPricing(container)).source !== "cardkingdom") return;
    const result = await syncCardKingdomPrices(container);
    logger.info(`[cardkingdom] prices refreshed: ${result.matched}/${result.printings} printings in ${result.sets} sets, ${result.updated} changed`);
  } catch (error) { logger.warn(`[cardkingdom] daily price refresh failed: ${(error as Error).message}`); }
}
export const config = { name: "cardkingdom-prices", schedule: "30 7 * * *" };
