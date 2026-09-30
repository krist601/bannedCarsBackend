export const sectionDefaults = {
  sealed: true,
  homeBanner: true,
  homeSealed: true,
  homeSingles: true,
  sealedBanner: true,
  sealedCategories: true,
  sealedLatest: true,
  sealedAlmostGone: true,
  sealedDeals: true,
  sealedNew: true,
  buyCards: true,
  bulkFinder: true,
  family: true,
};
export type StorefrontSections = typeof sectionDefaults;
export function normalizeSections(value: unknown): StorefrontSections {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(sectionDefaults).map(([key, fallback]) => [key, typeof saved[key] === 'boolean' ? saved[key] : fallback])) as StorefrontSections;
}
