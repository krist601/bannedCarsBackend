import type { MedusaContainer } from "@medusajs/framework/types"
import type { StoredSet } from "./set-directory"
export type SetCatalog = {
  listGames(filters: Record<string, unknown>): Promise<{ id: string }[]>
  createGames(data: Record<string, unknown>): Promise<{ id: string }>
  listCardSets(filters: Record<string, unknown>, config: Record<string, unknown>): Promise<StoredSet[]>
  createCardSets(data: Record<string, unknown>): Promise<StoredSet>
  updateCardSets(data: Record<string, unknown>): Promise<StoredSet>
}
export async function readMagicSets(container: MedusaContainer) {
  const catalog = container.resolve<SetCatalog>("tcgCatalog")
  const [game] = await catalog.listGames({ handle: "magic" })
  if (!game) return []
  const sets: StoredSet[] = []
  for (let skip = 0; ; skip += 500) {
    const page = await catalog.listCardSets({ game_id: game.id }, { skip, take: 500, order: { id: "ASC" } })
    sets.push(...page)
    if (page.length < 500) return sets
  }
}
