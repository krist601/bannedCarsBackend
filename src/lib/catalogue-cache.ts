type Build = () => Promise<any>;
type Entry = { fresh_until: number; usable_until: number; value: Promise<any>; refreshing: boolean };
const entries = new Map<string, Entry>();
const builders = new Map<string, Build>();
const FRESH_MS = 30_000;
const STALE_MS = 5 * 60_000;
let prewarm: ReturnType<typeof setTimeout> | undefined;
const pending = new Set<string>();
export function cachedCatalogue<T>(key: string, build: () => Promise<T>): Promise<T> {
  builders.set(key, build);
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now < hit.usable_until) {
    if (now >= hit.fresh_until && !hit.refreshing) {
      hit.refreshing = true;
      build().then(
        (next) => { if (entries.get(key) === hit) entries.set(key, { fresh_until: Date.now() + FRESH_MS, usable_until: Date.now() + STALE_MS, value: Promise.resolve(next), refreshing: false }); },
        () => { hit.refreshing = false; },
      );
    }
    return hit.value;
  }
  const value = build();
  const entry: Entry = { fresh_until: now + FRESH_MS, usable_until: now + STALE_MS, value, refreshing: false };
  entries.set(key, entry);
  value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
  return value;
}
export function invalidateCatalogueCache() {
  for (const key of entries.keys()) pending.add(key);
  entries.clear();
  clearTimeout(prewarm); // coalesce bursts of CMS writes into one rebuild
  prewarm = setTimeout(() => { const keys = [...pending]; pending.clear(); for (const key of keys) if (!entries.has(key)) void cachedCatalogue(key, builders.get(key)!).catch(() => {}); }, 500);
  prewarm.unref?.();
}
