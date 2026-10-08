import type { projectCardCatalogue } from "./card-catalogue-projection"
type Card = ReturnType<typeof projectCardCatalogue>[number]
export function cataloguePage(cards: Card[], options: { offset: number; limit: number; q?: string; sets?: string[]; rankedIds?: string[]; showOutOfStock?: boolean; sort?: "added" | "release" }) {
  const ranks = new Map(options.rankedIds?.map((id, index) => [id, index]))
  const groups = new Map<string, Card[]>()
  for (const card of cards) {
    if (options.q && !`${card.name} ${card.set}`.toLowerCase().includes(options.q.toLowerCase())) continue
    if (options.sets && !options.sets.includes(card.set_code.toLowerCase())) continue
    const key = JSON.stringify([card.printing_id, card.language?.toLowerCase() ?? "unknown"])
    const group = groups.get(key) ?? []
    group.push(card); groups.set(key, group)
  }
  const rank = (group: Card[]) => Math.min(...group.map(card => ranks.get(card.variant_id ?? card.id) ?? Infinity))
  const available = (group: Card[]) => group.some(card => card.stock !== 0)
  const price = (group: Card[]) => Math.max(...group.filter(card => !available(group) || card.stock !== 0).map(card => card.price_clp ?? -1))
  const sorted = [...groups.values()].filter(group => options.showOutOfStock !== false || available(group)).filter(group => !options.rankedIds || rank(group) !== Infinity)
    .sort((a, b) => (options.sort === "release" ? (b[0].released_at ?? "").localeCompare(a[0].released_at ?? "") || price(b) - price(a) : options.sort === "added" ? (b[0].added_at ?? "").localeCompare(a[0].added_at ?? "") : options.rankedIds ? rank(a) - rank(b) : Number(available(b)) - Number(available(a)) || price(b) - price(a)) || a[0].name.localeCompare(b[0].name) || a[0].printing_id.localeCompare(b[0].printing_id) || (a[0].language ?? "").localeCompare(b[0].language ?? ""))
  const page = sorted.slice(options.offset, options.offset + options.limit)
  return { cards: page.flat(), count: sorted.length, offset: options.offset, limit: options.limit, nextOffset: options.offset + options.limit < sorted.length ? options.offset + options.limit : null }
}
