import { Modules } from "@medusajs/framework/utils";
import { normalizeSections } from "./storefront-sections";
export type PricingSettings = { rate: number; minimum: number; rounding: number; source: "scryfall" | "cardkingdom" };
/** source: where USD prices come from. Card Kingdom (retail, Near Mint) falls back to Scryfall for cards it does not list. */
export const defaultPricing: PricingSettings = { rate: 750, minimum: 300, rounding: 50, source: "scryfall" };
export async function readPricing(scope:any) {
  const [store]=await scope.resolve(Modules.STORE).listStores({}, {take:1});
  const saved=store?.metadata?.card_pricing ?? {};
  return {...defaultPricing,...saved,source:saved.source==="cardkingdom"?"cardkingdom":"scryfall"} as PricingSettings;
}
export async function pricingSettings(req:any,res:any) {
  const user=await req.scope.resolve(Modules.USER).retrieveUser(req.auth_context.actor_id);
  if(user.metadata?.isAdmin!==true)return res.status(403).json({message:"Only administrators can manage pricing settings."});
  if(req.method==='POST'){
    const {rate,minimum}=req.body;
    const rounding=req.body.rounding ?? 50;
    const source=req.body.source===undefined?(await readPricing(req.scope)).source:req.body.source;
    if(source!=="scryfall"&&source!=="cardkingdom")return res.status(400).json({message:"Choose Scryfall or Card Kingdom as the price source."});
    if(!Number.isSafeInteger(rate)||rate<1||rate>100000||!Number.isSafeInteger(minimum)||minimum<1||minimum>100000000||!Number.isSafeInteger(rounding)||rounding<1||rounding>100000000)return res.status(400).json({message:"Enter a whole-number multiplier (1–100,000) and positive whole-number minimum and rounding amounts."});
    await req.scope.resolve(Modules.LOCKING).execute('cms-pricing-settings',async()=>{
      const service=req.scope.resolve(Modules.STORE);
      const [store]=await service.listStores({}, {take:1});
      // The store shows a "prices based on Card Kingdom" note while that source is selected.
      const sections={...normalizeSections(store.metadata?.storefront_sections),cardKingdomPrices:source==="cardkingdom"};
      await service.updateStores(store.id,{metadata:{...store.metadata,card_pricing:{rate,minimum,rounding,source},storefront_sections:sections}});
    });
  }
  res.setHeader('Cache-Control','no-store');
  return res.json({settings:await readPricing(req.scope)});
}
