/** The brand prefix WPN puts in front of set and product names: "Magic: The Gathering® | ...". */
const BRAND_PREFIX = /^\s*magic\s*:?\s*the\s+gathering\s*[®™]?\s*[|:\-–—]?\s*/i;
const withoutBrand = (s: string) => s.replace(BRAND_PREFIX, "").trim();
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Set name for display: "Magic: The Gathering® | Marvel Super Heroes" becomes "Marvel Super Heroes". */
export function sealedSetName(setName: string) {
  return withoutBrand(setName);
}

/**
 * Product name for the shop: just the product ("Bundle", "Play Booster Display"). The set is shown on its own line,
 * so the brand prefix and any leading (even repeated) set name are removed from the name.
 */
export function sealedProductTitle(setName: string, productName: string) {
  const set = words(withoutBrand(setName));
  let title = withoutBrand(productName);
  if (set.length) {
    const leadingSet = new RegExp(`^[^\\p{L}\\p{N}]*${set.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])[^\\p{L}\\p{N}]*`, "iu");
    for (;;) {
      const next = withoutBrand(title.replace(leadingSet, ""));
      if (!next || next === title) break;
      title = next;
    }
  }
  return title;
}
