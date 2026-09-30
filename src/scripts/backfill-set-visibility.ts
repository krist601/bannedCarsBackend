import type { ExecArgs } from "@medusajs/framework/types"
import { readMagicSets, type SetCatalog } from "../lib/set-directory-store"

// Materialize the CMS default without changing any saved visibility preference.
export default async function backfillSetVisibility({ container }: ExecArgs) {
  const catalog = container.resolve<SetCatalog>("tcgCatalog")
  const sets = await readMagicSets(container)
  let updated = 0
  for (const set of sets) {
    if (set.metadata?.isVisible !== undefined) continue
    await catalog.updateCardSets({ id: set.id, metadata: { ...set.metadata, isVisible: true } })
    updated++
  }
  console.log(`Set visibility: initialized ${updated} missing values; preserved ${sets.length - updated} existing values.`)
}
