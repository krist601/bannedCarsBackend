import { groupCmsSets } from "./cms-set-groups"
import type { StoredSet } from "./set-directory"
export function pageVisibleSets(records: StoredSet[], options: { offset: number; limit: number; query?: string }, today = new Date().toISOString().slice(0, 10)) {
  const query = options.query?.trim().toLowerCase() ?? ""
  const byId = new Map(records.map(set => [set.id, set]))
  const sets = groupCmsSets(records).filter(group => group.isVisible)
    .map(group => {
      const visible = group.divisions.filter(set => set.isVisible)
      const root = byId.get(group.id)!
      return { code: group.code.toLowerCase(), name: group.name, releasedAt: group.released_at,
        iconUrl: typeof root.metadata?.icon_storage_url === "string" ? root.metadata.icon_storage_url : null,
        upcoming: group.released_at !== null && group.released_at > today,
        setCodes: visible.map(set => set.code.toLowerCase()),
        matches: !query || visible.some(set => set.name.toLowerCase().includes(query) || set.code.toLowerCase().includes(query)) }
    }).filter(set => set.matches).map(({ matches, ...set }) => set)
  const lastOffset = Math.max(0, Math.ceil(sets.length / options.limit) - 1) * options.limit
  const offset = Math.min(options.offset, lastOffset)
  return { sets: sets.slice(offset, offset + options.limit), offset, previousOffset: offset > 0 ? Math.max(0, offset - options.limit) : null, nextOffset: offset + options.limit < sets.length ? offset + options.limit : null }
}
