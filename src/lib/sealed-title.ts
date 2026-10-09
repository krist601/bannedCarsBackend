const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The brand prefix WPN puts in front of set and product names: "Magic: The Gathering® | ...". */
const BRAND_PREFIX = /^\s*magic\s*:?\s*the\s+gathering\s*[®™]?\s*[|:\-–—]?\s*/i;
const withoutBrand = (s: string) => s.replace(BRAND_PREFIX, "").trim();
/**
 * "<Set> <Product>" unless the product name already carries the set name, and without the "Magic: The Gathering® |"
 * brand prefix (avoids "Magic: The Gathering® | X Magic: The Gathering® | X Bundle" and "Reality Fracture Reality Fracture Bundle").
 */
export function sealedProductTitle(setName: string, productName: string) {
  const set = withoutBrand(setName);
  const product = withoutBrand(productName);
  if (!set || nameKey(product).includes(nameKey(set))) return product;
  return `${set} ${product}`.trim();
}
