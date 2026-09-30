// Natural ordering keeps collector numbers 2, 10, 10a in their expected order.
const collectors = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
export function compareCollectors(
  a: { id: string; collector_number?: string | null },
  b: { id: string; collector_number?: string | null },
) {
  const left = a.collector_number || "",
    right = b.collector_number || "";
  if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id);
  return collectors.compare(left, right) || a.id.localeCompare(b.id);
}
export async function readAllCmsRows<T>(
  read: (skip: number) => Promise<[T[], number]>,
): Promise<T[]> {
  const result: T[] = [];
  for (let skip = 0; ; skip += 500) {
    const [rows, count] = await read(skip);
    result.push(...rows);
    if (rows.length < 500 || result.length >= count) return result;
  }
}
export type SortableSet = {
  id: string;
  name: string;
  code: string;
  released_at?: Date | string | null;
  metadata?: Record<string, unknown> | null;
};
export const isSetVisible = (set: Pick<SortableSet, "metadata">) =>
  set.metadata?.isVisible !== false;
function releaseTime(set?: SortableSet) {
  const time = set?.released_at ? new Date(set.released_at).getTime() : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}
export function compareSetsNewest(a: SortableSet, b: SortableSet) {
  const left = releaseTime(a),
    right = releaseTime(b);
  return (
    (left === right ? 0 : left > right ? -1 : 1) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}
export function compareCardsBySet(
  a: { id: string; set_id: string; collector_number?: string | null },
  b: { id: string; set_id: string; collector_number?: string | null },
  sets: Map<string, SortableSet>,
) {
  if (a.set_id !== b.set_id) {
    const left = sets.get(a.set_id),
      right = sets.get(b.set_id);
    if (left && right) return compareSetsNewest(left, right);
    return left ? -1 : right ? 1 : a.set_id.localeCompare(b.set_id);
  }
  return compareCollectors(a, b);
}
