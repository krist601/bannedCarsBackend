type Entry = { fresh_until: number; usable_until: number; value: Promise<any>; refreshing: boolean };
const entries = new Map<string, Entry>();
const FRESH_MS = 30_000;
const STALE_MS = 5 * 60_000;

/**
 * Shares one catalogue build between requests for the same store. After 30 s the previous
 * copy is still served (for up to 5 min) while a new one builds in the background, so
 * shoppers rarely wait for the slow full build. CMS writes clear it (see invalidateCatalogueCache).
 */
export function cachedCatalogue<T>(key: string, build: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now < hit.usable_until) {
    if (now >= hit.fresh_until && !hit.refreshing) {
      hit.refreshing = true;
      build().then(
        (next) => entries.set(key, { fresh_until: Date.now() + FRESH_MS, usable_until: Date.now() + STALE_MS, value: Promise.resolve(next), refreshing: false }),
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
export const invalidateCatalogueCache = () => entries.clear();
