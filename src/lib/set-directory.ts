export type StoredSet = {
  id: string; code: string; name: string; released_at: Date | string | null;
  metadata?: Record<string, unknown> | null
}
export type DirectorySet = {
  code: string; name: string; releasedAt: string | null; iconUrl: string | null; upcoming: boolean
}
export type SetGroup = { id: string; name: string; releasedAt: string | null; sets: DirectorySet[] }
const text = (value: unknown) => typeof value === "string" ? value : null
const date = (value: Date | string | null) => value ? new Date(value).toISOString().slice(0, 10) : null

export function groupSets(sets: StoredSet[], today = new Date().toISOString().slice(0, 10)): SetGroup[] {
  const byCode = new Map(sets.map(set => [set.code.toLowerCase(), set]))
  const groups = new Map<string, SetGroup>()
  for (const set of sets) {
    let root = set
    const seen = new Set([set.code.toLowerCase()])
    while (true) {
      const parent = text(root.metadata?.parent_set_code)?.toLowerCase()
      if (!parent || seen.has(parent) || !byCode.has(parent)) break
      seen.add(parent)
      root = byCode.get(parent)!
    }
    // Parent families take precedence over broad product categories such as Commander.
    // Core sets and supplemental series are standalone releases, not historical blocks.
    const rootType = text(root.metadata?.set_type)
    const block = (!rootType || rootType === "expansion") && root.metadata?.block_code !== "mh1" ? text(root.metadata?.block_code) : null
    const id = block ? `block:${block}` : `set:${root.code.toLowerCase()}`
    const releasedAt = date(set.released_at)
    const group = groups.get(id) ?? { id, name: block ? text(root.metadata?.block) || text(set.metadata?.block) || root.name : root.name, releasedAt: null, sets: [] }
    group.sets.push({ code: set.code.toLowerCase(), name: set.name, releasedAt, iconUrl: text(set.metadata?.icon_storage_url), upcoming: releasedAt !== null && releasedAt > today })
    if (releasedAt && (!group.releasedAt || releasedAt > group.releasedAt)) group.releasedAt = releasedAt
    groups.set(id, group)
  }
  const newest = (a: { releasedAt: string | null; name: string }, b: { releasedAt: string | null; name: string }) =>
    (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") || a.name.localeCompare(b.name)
  return [...groups.values()].map(group => ({ ...group, sets: group.sets.sort(newest) })).sort((a, b) => newest(a, b) || a.id.localeCompare(b.id))
}

export function latestSetCodes(sets: StoredSet[], today = new Date().toISOString().slice(0, 10)) {
  // Latest releases means the two newest released main sets and their related products.
  const main = sets.filter(set => ["expansion", "core", "draft_innovation"].includes(String(set.metadata?.set_type)) && date(set.released_at) && date(set.released_at)! <= today)
    .sort((a, b) => date(b.released_at)!.localeCompare(date(a.released_at)!) || a.code.localeCompare(b.code)).slice(0, 2)
  const groups = groupSets(sets, today)
  return groups.filter(group => group.sets.some(set => main.some(root => root.code.toLowerCase() === set.code)))
    .flatMap(group => group.sets.filter(set => !set.upcoming).map(set => set.code))
}

export function pageGroups(groups: SetGroup[], options: { cursor?: string; limit: number; query?: string }) {
  const query = options.query?.trim().toLowerCase()
  const filtered = query ? groups.map(group => ({ ...group, sets: group.sets.filter(set => group.name.toLowerCase().includes(query) || set.name.toLowerCase().includes(query) || set.code.includes(query)) })).filter(group => group.sets.length) : groups
  const index = options.cursor ? filtered.findIndex(group => group.id === options.cursor) : -1
  if (options.cursor && index < 0) throw new Error("Unknown cursor; reload the set list")
  const page = filtered.slice(index + 1, index + 1 + options.limit)
  return { groups: page, nextCursor: index + 1 + page.length < filtered.length ? page.at(-1)?.id ?? null : null }
}
