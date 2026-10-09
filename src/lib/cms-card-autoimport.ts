import { Modules } from "@medusajs/framework/utils";
import { getJson, printingData, SCRYFALL_API, type ScryfallCard, type ScryfallSet } from "./scryfall-set-import";
import { syncCardImages } from "./card-image-sync";
import { basePrices } from "./cms-base-prices";
import { readPricing } from "./cms-pricing-settings";

/** Read-only Scryfall lookup used by the stock import preview. Returns null when Scryfall has no such card. */
export async function lookupScryfallCard(code: string, collector: string, fetcher: typeof fetch = fetch): Promise<ScryfallCard | null> {
  if (!/^[a-z0-9]{2,12}$/.test(code) || !collector || collector.length > 20) return null;
  try {
    const card = await getJson<ScryfallCard>(`${SCRYFALL_API}/cards/${encodeURIComponent(code)}/${encodeURIComponent(collector)}`, fetcher);
    return card.set === code && card.id && card.name ? card : null;
  } catch (error) {
    if (/HTTP 404/.test((error as Error).message)) return null;
    throw error;
  }
}

/**
 * Creates the missing set (if needed) and the single printing from Scryfall, stores its
 * image in the configured file storage and saves its base CLP prices. Safe to repeat: an
 * existing printing is returned untouched.
 */
export async function importMissingCard(scope: any, code: string, collector: string, fetcher: typeof fetch = fetch) {
  const card = await lookupScryfallCard(code, collector, fetcher);
  if (!card) throw new Error(`Card ${code.toUpperCase()} ${collector} was not found on Scryfall.`);
  return scope.resolve(Modules.LOCKING).execute(`cms-card-import:${code}`, async () => {
    const catalog = scope.resolve("tcgCatalog");
    const [existingGame] = await catalog.listGames({ handle: "magic" }, { take: 1 });
    const game = existingGame ?? await catalog.createGames({ handle: "magic", name: "Magic: The Gathering", publisher: "Wizards of the Coast", metadata: { data_source: "scryfall" } });
    let [set] = await catalog.listCardSets({ game_id: game.id, code }, { take: 1 });
    if (!set) {
      const scryfallSet = await getJson<ScryfallSet>(`${SCRYFALL_API}/sets/${encodeURIComponent(code)}`, fetcher);
      set = await catalog.createCardSets({
        game_id: game.id, code: scryfallSet.code, name: scryfallSet.name,
        released_at: scryfallSet.released_at ? new Date(scryfallSet.released_at) : null,
        metadata: { isVisible: true, scryfall_id: scryfallSet.id, scryfall_data: scryfallSet, scryfall_imported_at: new Date().toISOString() },
      });
    }
    const [current] = await catalog.listCardPrintings({ set_id: set.id, external_id: card.id }, { take: 1 });
    if (current) return { printing_id: current.id, created: false, warnings: [] as string[] };
    await catalog.createCardPrintings(printingData(card, game.id, set.id));
    const [printing] = await catalog.listCardPrintings({ set_id: set.id, external_id: card.id }, { take: 1 });
    if (!printing) throw new Error("The imported card could not be saved.");
    const warnings: string[] = [];
    try {
      if (process.env.FILE_STORAGE_DRIVER !== "s3") throw new Error("S3 image storage is not configured.");
      const files = scope.resolve(Modules.FILE);
      const summary = await syncCardImages([printing], {
        storage: { upload: (input) => files.createFiles({ ...input, access: "public" }), remove: (ids) => files.deleteFiles(ids) },
        writer: { update: async (id, data) => { await catalog.updateCardPrintings({ id, ...data }); } },
        logger: { info() {}, warn() {}, error() {} },
      });
      if (summary.failed) warnings.push("The card image could not be stored. Run the image sync later.");
    } catch (error) {
      warnings.push(`Card image not stored: ${(error as Error).message}`);
    }
    const [fresh] = await catalog.listCardPrintings({ id: printing.id }, { take: 1 });
    const settings = await readPricing(scope);
    const prices = basePrices(fresh ?? printing, settings);
    await catalog.updateCardPrintings({ id: printing.id, attributes: { ...(fresh ?? printing).attributes, base_prices_clp: prices, base_price_rate: settings.rate, base_price_minimum: settings.minimum, base_price_rounding: settings.rounding, base_prices_updated_at: new Date().toISOString() } });
    return { printing_id: printing.id as string, created: true, warnings };
  });
}
