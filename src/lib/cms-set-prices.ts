import { usdToClp } from "./cms-price-conversion";
import { readPricing, defaultPricing } from "./cms-pricing-settings";
import { refreshSetBasePrices } from "./cms-base-prices";
import { cardKingdomPricesForSet, type CkPrices } from "./cardkingdom-prices";

const cache = new Map<string, { expires: number; result: any }>();
const pending = new Map<string, Promise<any>>();
const headers = { Accept: "application/json", "User-Agent": "BannedCardsCMS/1.0 (set-price-preview)" };

export async function fetchScryfallSetCards(code: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-z0-9]{2,12}$/.test(code)) throw new Error("Invalid set code.");
  const cards: any[] = [];
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
    for (const card of data.data) if (card.set === code) cards.push(card);
    if (data.has_more && typeof data.next_page !== "string") throw new Error("Scryfall pagination is incomplete.");
    url = data.has_more ? data.next_page : null;
  }
  return cards;
}

/** `ck`: Card Kingdom prices by Scryfall id, used first when given (Scryfall fills the cards Card Kingdom does not list). */
export async function fetchSetPrices(code: string, fetcher: typeof fetch = fetch, settings: {rate:number;minimum:number;rounding?:number;source?:string} = defaultPricing, ck: Map<string, CkPrices> | null = null) {
  const rows: any[] = [];
  for (const card of await fetchScryfallSetCards(code, fetcher)) {
      const own = ck?.get(card.id);
      rows.push({ id: card.id, name: card.name, collector_number: card.collector_number,
        prices: [
          ["Non-foil", "usd"], ["Foil", "usd_foil"], ["Etched", "usd_etched"],
        ].map(([finish, key]) => {
          const fromCk = own?.[key as keyof CkPrices] && usdToClp(own[key as keyof CkPrices],settings) !== null;
          const value = fromCk ? own![key as keyof CkPrices] : card.prices?.[key];
          const clp = usdToClp(value,settings);
          return { finish, usd: clp === null ? null : value, clp, source: clp === null ? null : fromCk ? "Card Kingdom" : "Scryfall" };
        }),
      });
  }
  return rows.sort((a,b) => String(a.collector_number).localeCompare(String(b.collector_number), "en", {numeric:true}));
}

export async function previewSetPrices(req: any, res: any) {
  try {
    if (typeof req.body.set_id !== "string") return res.status(400).json({message:"Select a set."});
    const set = await req.scope.resolve("tcgCatalog").retrieveCardSet(req.body.set_id);
    const code = String(set.code).toLowerCase();
    const settings = await readPricing(req.scope);
    const cacheKey = `${code}:${settings.rate}:${settings.minimum}:${settings.rounding}:${settings.source}`;
    let result = cache.get(cacheKey)?.expires! > Date.now() ? cache.get(cacheKey)!.result : null;
    if (!result) {
      let work = pending.get(cacheKey);
      if (!work) {
        work = (async () => {
          let ck: Map<string, CkPrices> | null = null, warning = "";
          if (settings.source === "cardkingdom") { try { ck = await cardKingdomPricesForSet(code); if (!ck) warning = "Card Kingdom has no price file for this set; Scryfall prices are shown."; } catch (e) { warning = `Card Kingdom prices are unavailable (${(e as Error).message}); Scryfall prices are shown.`; } }
          return { rows: await fetchSetPrices(code,fetch,settings,ck), warning };
        })().then(({rows,warning}) => {
          const result = {rows, warning, fetched_at:new Date().toISOString(),source:settings.source === "cardkingdom" ? "Card Kingdom USD (retail, Near Mint), Scryfall for cards it does not list" : "Scryfall USD",price_source:settings.source,rate:settings.rate,minimum:settings.minimum,rounding:settings.rounding};
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

const running = new Set<string>();
/** `set_prices_update`: fetch current Scryfall prices and apply them to automatic listings. `set_prices_reset`: restore stored Scryfall prices on every listing, custom ones included. */
export async function applySetPrices(req: any, res: any) {
  const reset = req.body.action === "set_prices_reset";
  if (typeof req.body.set_id !== "string") return res.status(400).json({message:"Select a set."});
  let lockKey = "";
  try {
    const catalog = req.scope.resolve("tcgCatalog");
    const set = await catalog.retrieveCardSet(req.body.set_id);
    const code = String(set.code).toLowerCase();
    lockKey = set.id;
    if (running.has(lockKey)) return res.status(409).json({message:"A price change is already running for this set."});
    running.add(lockKey);
    let fetched = 0, matched = 0, ckMatched = 0, ckWarning = "";
    const settings = await readPricing(req.scope);
    if (!reset) {
      let ck: Map<string, CkPrices> | null = null;
      if (settings.source === "cardkingdom") { try { ck = await cardKingdomPricesForSet(code); if (!ck) ckWarning = "Card Kingdom has no price file for this set; Scryfall prices were used."; } catch (e) { ckWarning = `Card Kingdom prices are unavailable (${(e as Error).message}); Scryfall prices were used.`; } }
      const cards = new Map((await fetchScryfallSetCards(code)).map(card => [card.id, card]));
      fetched = cards.size;
      if (!fetched) return res.status(404).json({message:"No paper cards found on Scryfall for this set. Nothing was changed."});
      for (let skip=0;;skip+=200) {
        const printings = await catalog.listCardPrintings({set_id:set.id},{take:200,skip,order:{id:"ASC"}});
        for (const printing of printings) {
          const card = cards.get(printing.external_id);
          if (!card) continue;
          matched++;
          const own = ck?.get(printing.external_id) ?? null;
          if (own) ckMatched++;
          await catalog.updateCardPrintings({id:printing.id,attributes:{...printing.attributes,scryfall_data:{...printing.attributes?.scryfall_data,prices:card.prices},...(ck ? {ck_prices:own} : {})}});
        }
        if (printings.length<200) break;
      }
    }
    const summary = await refreshSetBasePrices(req.scope,code,{overrideCustom:reset});
    return res.json({mode:reset?"reset":"update",set:{id:set.id,name:set.name,code},fetched,matched,price_source:settings.source,card_kingdom_matched:ckMatched,card_kingdom_warning:ckWarning,...summary});
  } catch (e) { return res.status(502).json({message:(e as Error).message}); }
  finally { if (lockKey) running.delete(lockKey); }
}
