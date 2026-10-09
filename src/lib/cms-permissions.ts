export const CMS_SECTIONS = [
  "overview",
  "storefront",
  "cards",
  "sets",
  "stock",
  "sealed",
  "custom",
  "accessories",
  "orders",
];
export function cmsPermissions(user: any) {
  const admin = user?.metadata?.isAdmin === true;
  const saved = user?.metadata?.cmsAccess;
  return {
    admin,
    canCreateSealed: admin || saved?.canCreateSealed === true,
    enabled: admin || saved?.enabled === true,
    sections: admin
      ? [...CMS_SECTIONS, "users", "stores", "pricing", "backups"]
      : CMS_SECTIONS.filter(
          (s) => Array.isArray(saved?.sections) && saved.sections.includes(s),
        ),
    warehouseIds: admin
      ? null
      : Array.isArray(saved?.warehouseIds)
        ? saved.warehouseIds.filter((s: unknown) => typeof s === "string")
        : [],
  };
}
const reads: Record<string, string[]> = {
  backups: ["backups"],
  stores: ["stores"],
  pricing: ["pricing"],
  me: [],
  locations: [],
  users: ["users"],
  overview: ["overview"],
  storefront_settings: ["storefront"],
  cards: ["cards"],
  sets: ["sets"],
  set_options: ["cards", "stock", "sets"],
  set_sync_status: ["sets"],
  stock: ["stock", "cards"],
  sealed: ["sealed"],
  orders: ["orders"],
};
const writes: Record<string, string[]> = {
  backup_create: ["backups"],
  backup_restore: ["backups"],
  backup_resume: ["backups"],
  store_save: ["stores"],
  pricing_settings: ["pricing"],
  warehouse_create: ["stores"],
  set_prices: ["sets"],
  set_prices_update: ["sets"],
  set_sync: ["sets"],
  order_payment: ["orders"],
  set_prices_reset: ["sets"],
  user_save: ["users"],
  user_create: ["users"],
  storefront_settings: ["storefront"],
  stock_import: ["cards"],
  stock_import_preview: ["cards"],
  quick_add: ["cards"],
  listing: ["cards"],
  receive: ["stock", "cards"],
  subtract: ["stock", "cards"],
  price: ["stock", "cards"],
  card_sku: ["cards"],
  import: ["sets"],
  set_visibility: ["sets"],
  sealed_create: ["sealed"],
  sealed_image: ["sealed"],
  sealed_save: ["sealed"],
  sealed_price: ["sealed"],
  sealed_stock: ["sealed"],
  sealed_status: ["sealed"],
  sealed_find: ["sealed"],
  sealed_accept: ["sealed"],
  sealed_graphics: ["sealed"],
  sealed_banner: ["sealed"],
};
export function canAccessCms(
  user: any,
  method: string,
  key: string,
  location?: unknown,
  productSection?: unknown,
) {
  const p = cmsPermissions(user);
  if (!p.enabled) return false;
  // Custom products and accessories reuse the sealed product actions but have their own permission.
  if ((productSection === "custom" || productSection === "accessories") && /^sealed(_(create|save|price|stock|status|image))?$/.test(key)) {
    if (!p.sections.includes(productSection)) return false;
    return !location || p.warehouseIds === null || p.warehouseIds.includes(location);
  }
  if (productSection !== undefined && productSection !== "" && productSection !== "sealed" && /^sealed(_|$)/.test(key)) return false;
  if (method !== "GET" && ["sealed_create", "sealed_accept"].includes(key) && !p.canCreateSealed) return false;
  const sections = (method === "GET" ? reads : writes)[key];
  if (
    !sections ||
    (sections.length && !sections.some((s) => p.sections.includes(s)))
  )
    return false;
  return (
    !location || p.warehouseIds === null || p.warehouseIds.includes(location)
  );
}
// Remove other warehouses from every nested inventory response, including mutations.
export function scopeWarehouseResponse(
  value: any,
  warehouseIds: string[] | null,
): any {
  if (warehouseIds === null || value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value
      .filter((v) => !v?.location_id || warehouseIds.includes(v.location_id))
      .map((v) => scopeWarehouseResponse(v, warehouseIds));
  const result: any = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      scopeWarehouseResponse(v, warehouseIds),
    ]),
  );
  if (Array.isArray(result.levels) && "quantity" in result)
    result.quantity = result.levels.reduce(
      (sum: number, l: any) => sum + Number(l.available_quantity || 0),
      0,
    );
  return result;
}
