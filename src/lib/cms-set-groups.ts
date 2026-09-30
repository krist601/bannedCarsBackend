type CardSet = {
  id: string;
  code: string;
  name: string;
  released_at: Date | string | null;
  metadata?: Record<string, unknown> | null;
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
function release(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}
function baseName(name: string): string {
  return name
    .replace(/(?:[\s:–—-]+(?:commander|tokens?|promos?|art series))+$/i, "")
    .trim()
    .toLowerCase();
}
export function groupCmsSets(sets: CardSet[]) {
  const byCode = new Map(sets.map((set) => [set.code.toLowerCase(), set]));
  const byName = new Map(sets.map((set) => [set.name.toLowerCase(), set]));
  const groups = new Map<string, { root: CardSet; divisions: CardSet[] }>();
  for (const set of sets) {
    let root = set;
    const visited = new Map<string, CardSet>();
    while (true) {
      const code = root.code.toLowerCase();
      if (visited.has(code)) {
        root = [...visited.values()].sort((a, b) =>
          a.code.localeCompare(b.code),
        )[0];
        break;
      }
      visited.set(code, root);
      const source = root.metadata?.scryfall_data as
        Record<string, unknown> | undefined;
      const parentCode = text(
        root.metadata?.parent_set_code || source?.parent_set_code,
      ).toLowerCase();
      const base = baseName(root.name);
      const parent =
        byCode.get(parentCode) ||
        (base !== root.name.toLowerCase() ? byName.get(base) : undefined);
      if (!parent) break;
      root = parent;
    }
    const group = groups.get(root.id) || { root, divisions: [] };
    group.divisions.push(set);
    groups.set(root.id, group);
  }
  const project = (set: CardSet) => ({
    id: set.id,
    code: set.code,
    name: set.name,
    released_at: release(set.released_at),
    isVisible: set.metadata?.isVisible !== false,
  });
  const newest = (
    a: { released_at: string | null; name: string },
    b: { released_at: string | null; name: string },
  ) =>
    (b.released_at || "").localeCompare(a.released_at || "") ||
    a.name.localeCompare(b.name);
  return [...groups.values()]
    .map(({ root, divisions }) => ({
      ...project(root),
      divisions: divisions
        .map(project)
        .sort((a, b) =>
          a.id === root.id ? -1 : b.id === root.id ? 1 : newest(a, b),
        ),
    }))
    .sort((a, b) => newest(a, b) || a.code.localeCompare(b.code));
}
