import { usdToClp } from "./cms-price-conversion";
import { readPricing, defaultPricing } from "./cms-pricing-settings";

const cache = new Map<string, { expires: number; result: any }>();
const pending = new Map<string, Promise<any>>();
const headers = { Accept: "application/json", "User-Agent": "BannedCardsCMS/1.0 (set-price-preview)" };

export async function fetchSetPrices(code: string, fetcher: typeof fetch = fetch, settings = defaultPricing) {
  if (!/^[a-z0-9]{2,12}$/.test(code)) throw new Error("Invalid set code.");
  const rows: any[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${code} game:paper`)}&unique=prints&order=set`;
  const visited = new Set<string>();
  while (url) {
    const parsed = new URL(url);
    if (parsed.origin !== "https://api.scryfall.com" || parsed.pathname !== "/cards/search" || visited.has(url) || visited.size >= 100)
      throw new Error("Invalid Scryfall pagination response.");
    if (visited.size) await new Promise(resolve => setTimeout(resolve, 100));
    visited.add(url);
    const response: Response = await fetcher(url, { headers, signal: AbortSignal.timeout(20000) });
    if (response.status === 404 && visited.size === 1) return [];
    if (!response.ok) throw new Error(`Scryfall returned HTTP ${response.status}. Please try again later.`);
    const data: any = await response.json();
    if (!Array.isArray(data.data)) throw new Error("Scryfall returned an invalid price response.");
    for (const card of data.data) {
      if (card.set !== code) continue;
      rows.push({ id: card.id, name: card.name, collector_number: card.collector_number,
        prices: [
          ["Non-foil", "usd"], ["Foil", "usd_foil"], ["Etched", "usd_etched"],
        ].map(([finish, key]) => {
          const clp = usdToClp(card.prices?.[key],settings);
          return { finish, usd: clp === null ? null : card.prices[key], clp };
        }),
      });
    }
    if (data.has_more && typeof data.next_page !== "string") throw new Error("Scryfall pagination is incomplete.");
    url = data.has_more ? data.next_page : null;
  }
  return rows.sort((a,b) => String(a.collector_number).localeCompare(String(b.collector_number), "en", {numeric:true}));
}

export async function previewSetPrices(req: any, res: any) {
  try {
    if (typeof req.body.set_id !== "string") return res.status(400).json({message:"Select a set."});
    const set = await req.scope.resolve("tcgCatalog").retrieveCardSet(req.body.set_id);
    const code = String(set.code).toLowerCase();
    const settings = await readPricing(req.scope);
    const cacheKey = `${code}:${settings.rate}:${settings.minimum}:${settings.rounding}`;
    let result = cache.get(cacheKey)?.expires! > Date.now() ? cache.get(cacheKey)!.result : null;
    if (!result) {
      let work = pending.get(cacheKey);
      if (!work) {
        work = fetchSetPrices(code,fetch,settings).then(rows => {
          const result = {rows, fetched_at:new Date().toISOString(),source:"Scryfall USD",rate:settings.rate,minimum:settings.minimum,rounding:settings.rounding};
          if (cache.size >= 30) cache.delete(cache.keys().next().value!);
          cache.set(cacheKey,{expires:Date.now()+300000,result});
          return result;
        }).finally(()=>pending.delete(cacheKey));
        pending.set(cacheKey,work);
      }
      result = await work;
    }
    return res.json({...result,set:{id:set.id,name:set.name,code}});
  } catch (e) { return res.status(502).json({message:(e as Error).message}); }
}
