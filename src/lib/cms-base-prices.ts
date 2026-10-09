import { Modules } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { usdToClp } from "./cms-price-conversion";
import { readPricing, defaultPricing } from "./cms-pricing-settings";

export function basePrices(printing: any, settings = defaultPricing) {
  const prices = printing.attributes?.scryfall_data?.prices;
  return { non_foil: usdToClp(prices?.usd,settings), foil: usdToClp(prices?.usd_foil,settings), etched: usdToClp(prices?.usd_etched,settings) };
}
export function basePrice(printing: any, finish: string, settings = defaultPricing): number | null {
  const prices = printing.attributes?.scryfall_data?.prices ? basePrices(printing,settings) : printing.attributes?.base_prices_clp ?? {};
  return prices[finish] > 0 ? prices[finish] : null;
}
export function hasCustomPrice(listing: any) {
  // Prices saved before automatic pricing existed were manually entered.
  return listing.metadata?.price_source === "custom" ||
    (listing.metadata?.price_source !== "scryfall" && Number(listing.price_clp) > 0 && listing.metadata?.price_pending !== true);
}

/** Recomputes printing base prices from stored Scryfall data and applies them to listings. `overrideCustom` also replaces hand-set prices. */
export async function refreshSetBasePrices(scope: any, code: string, options: { overrideCustom?: boolean } = {}) {
  const settings = await readPricing(scope);
  const catalog = scope.resolve("tcgCatalog");
  const [set] = await catalog.listCardSets({code}, {take:1});
  if (!set) throw new Error("Imported set not found.");
  const summary = { printings: 0, updated: 0, custom: 0, overridden: 0, unavailable: 0 };
  for (let skip=0;;skip+=200) {
    const printings = await catalog.listCardPrintings({set_id:set.id}, {take:200,skip,order:{id:"ASC"}});
    for (const printing of printings) {
      const prices = basePrices(printing,settings);
      await catalog.updateCardPrintings({id:printing.id,attributes:{...printing.attributes,base_prices_clp:prices,base_price_rate:settings.rate,base_price_minimum:settings.minimum,base_price_rounding:settings.rounding,base_prices_updated_at:new Date().toISOString()}});
      summary.printings++;
      for(let offset=0;;offset+=200) {
        const listings = await catalog.listCardListings({printing_id:printing.id},{take:200,skip:offset,order:{id:"ASC"}});
        for (const row of listings) await scope.resolve(Modules.LOCKING).execute(`cms-price:${row.id}`,async()=>{
          const listing = await catalog.retrieveCardListing(row.id);
          const custom = hasCustomPrice(listing);
          if(custom && !options.overrideCustom){summary.custom++;return;}
          const price = prices[listing.finish as keyof typeof prices] ?? null;
          if(!listing.variant_id || !listing.product_id) return;
          // Never wipe a hand-set price when Scryfall has nothing to replace it with.
          if(custom && !price){summary.custom++;return;}
          await updateProductVariantsWorkflow(scope).run({input:{product_variants:[{id:listing.variant_id,prices:price ? [{currency_code:"clp",amount:price}] : []}]}});
          // Only automatically publish listings previously waiting for a price.
          if(!price || listing.metadata?.price_pending === true) await updateProductsWorkflow(scope).run({input:{products:[{id:listing.product_id,status:price ? "published" : "draft"}]}});
          await catalog.updateCardListings({id:listing.id,price_clp:price ?? 0,metadata:{...listing.metadata,price_source:"scryfall",price_pending:!price}});
          summary.updated++;if(custom)summary.overridden++;if(!price)summary.unavailable++;
        });
        if(listings.length<200)break;
      }
    }
    if(printings.length<200)break;
  }
  return summary;
}
