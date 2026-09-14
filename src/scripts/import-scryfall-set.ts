import type { ExecArgs } from "@medusajs/framework/types"
import { importScryfallSet, type ExistingPrinting, type ScryfallSet } from "../lib/scryfall-set-import"

type Entity = { id: string; [key: string]: unknown }
type TcgCatalogService = {
  listGames(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]>
  createGames(data: Record<string, unknown>): Promise<Entity>
  updateGames(data: Record<string, unknown>): Promise<Entity>
  listCardSets(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Entity[]>
  createCardSets(data: Record<string, unknown>): Promise<Entity>
  updateCardSets(data: Record<string, unknown>): Promise<Entity>
  listCardPrintings(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<ExistingPrinting[]>
  createCardPrintings(data: Record<string, unknown>): Promise<Entity>
  updateCardPrintings(data: Record<string, unknown>): Promise<Entity>
}

function setArgument(args: string[]) {
  const named = args.find(value => value.startsWith("set=") || value.startsWith("--set="))
  const positional = args.find(value => !value.startsWith("-"))
  const code = named?.split("=", 2)[1] ?? positional
  if (!code) throw new Error("Missing set code. Example: pnpm catalog:import-set LTR")
  return code
}

export default async function importScryfallSetScript({ container, args }: ExecArgs) {
  const catalog = container.resolve("tcgCatalog") as TcgCatalogService
  const requestedCode = setArgument(args)
  const summary = await importScryfallSet(requestedCode, {
    store: {
      ensureMagicGame: async () => {
        const [existing] = await catalog.listGames({ handle: "magic" }, { take: 1 })
        if (existing) return catalog.updateGames({ id: existing.id, name: "Magic: The Gathering", publisher: "Wizards of the Coast" })
        return catalog.createGames({ handle: "magic", name: "Magic: The Gathering", publisher: "Wizards of the Coast", metadata: { data_source: "scryfall" } })
      },
      upsertSet: async (gameId: string, set: ScryfallSet) => {
        const [existing] = await catalog.listCardSets({ game_id: gameId, code: set.code }, { take: 1 })
        const data = {
          game_id: gameId, code: set.code, name: set.name,
          released_at: set.released_at ? new Date(set.released_at) : null,
          metadata: { scryfall_id: set.id, scryfall_data: set, scryfall_imported_at: new Date().toISOString() }
        }
        return existing ? catalog.updateCardSets({ id: existing.id, ...data }) : catalog.createCardSets(data)
      },
      listPrintings: async (setId: string) => {
        const records: ExistingPrinting[] = []
        for (let skip = 0; ; skip += 500) {
          const page = await catalog.listCardPrintings({ set_id: setId }, { skip, take: 500 })
          records.push(...page)
          if (page.length < 500) return records
        }
      },
      createPrinting: async data => { await catalog.createCardPrintings(data) },
      updatePrinting: async (id, data) => { await catalog.updateCardPrintings({ id, ...data }) }
    }
  })
  console.log(`Imported ${summary.setName} (${summary.setCode}): ${summary.discovered} cards, ${summary.created} created, ${summary.updated} updated`)
  console.log("Run pnpm images:sync to copy the imported card images into configured object storage.")
}
