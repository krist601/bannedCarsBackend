import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sealedProductTitle, sealedSetName } from "./sealed-title";
import { Modules } from "@medusajs/framework/utils";
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";
import { productStoreChannels } from "./cms-stores";
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);
export type FoundAsset = {
  id: string;
  title: string;
  url: string;
  kind: "image" | "download";
};
export type FoundProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  images: string[];
  existing?: boolean;
  msrp_usd?: number;
  price_clp?: number;
  price_rate?: number;
  price_date?: string;
};
type Preview = {
  game: string;
  code: string;
  setId: string;
  name: string;
  source: string;
  products: FoundProduct[];
  assets: FoundAsset[];
  expires: number;
};
export function trustedAsset(value: string) {
  const u = new URL(value.startsWith("//") ? "https:" + value : value);
  if (
    u.protocol !== "https:" ||
    !["images.ctfassets.net", "media.wizards.com"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new Error("Unsupported artwork source");
  return u.toString();
}
export function parseWpn(html: string, code: string) {
  const match = html.match(
    /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match)
    throw new Error("WPN page format changed. No products were saved.");
  const raw = JSON.parse(match[1]);
  if (!Array.isArray(raw) || raw.length > 100000)
    throw new Error("Invalid WPN data");
  const memo = new Map<number, any>();
  function decode(index: any): any {
    if (typeof index !== "number") return index;
    if (index < 0) return null;
    if (memo.has(index)) return memo.get(index);
    const v = raw[index];
    if (Array.isArray(v)) {
      const a: any[] = [];
      memo.set(index, a);
      for (const item of v) a.push(decode(item));
      return a;
    }
    if (v && typeof v === "object") {
      const o: any = Object.create(null);
      memo.set(index, o);
      for (const [k, x] of Object.entries(v))
        if (!["__proto__", "constructor", "prototype"].includes(k))
          o[k] = decode(x);
      return o;
    }
    return v;
  }
  const index = raw.findIndex(
    (v) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof v.setAbbreviation === "number" &&
      String(raw[v.setAbbreviation]).toLowerCase() === code,
  );
  if (index < 0)
    throw new Error("WPN page does not match the requested set code.");
  const set = decode(index);
  const productEntries = set.products || [];
  const products: FoundProduct[] = productEntries
    .map((entry: any) => {
      const p = entry.fields;
      const name = String(p.name || "");
      const category = /bundle/i.test(name)
        ? "bundles"
        : /display|box/i.test(name)
          ? "booster-boxes"
          : /booster/i.test(name) && !/prerelease/i.test(name)
            ? "booster-packs"
            : /deck/i.test(name)
              ? "precons"
              : "extras";
      return {
        id: String(entry.sys.id),
        name,
        sku: String(p.sku || ""),
        msrp_usd: /^\$\d+(?:,\d{3})*(?:\.\d{2})?$/.test(String(p.msrp || "").trim()) ? Number(String(p.msrp).replace(/[$,]/g, "")) : undefined,
        category,
        images: (p.images || [])
          .map((a: any) => a.fields?.file?.url)
          .filter(Boolean)
          .map(trustedAsset),
      };
    })
    .filter((p: FoundProduct) => p.name && p.images.length);
  const assets = new Map<string, FoundAsset>();
  function add(url: string, title: string) {
    try {
      const safe = trustedAsset(url);
      assets.set(safe, {
        id: hash(safe),
        url: safe,
        title: title || new URL(safe).pathname.split("/").pop() || "Artwork",
        kind: /\.(zip|pdf)(?:\?|$)/i.test(safe) ? "download" : "image",
      });
    } catch {}
  }
  const seen = new Set<any>();
  function walk(node: any, label = "") {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const title = typeof node.title === "string" ? node.title : label;
    if (node.file?.url) add(node.file.url, title);
    for (const [key, value] of Object.entries(node)) {
      if (["brand", "sys", "metadata"].includes(key)) continue;
      if (
        typeof value === "string" &&
        /^(https:)?\/\/(images\.ctfassets\.net|media\.wizards\.com)\//.test(
          value,
        )
      )
        add(value, title);
      else if (typeof value === "object") walk(value, title);
    }
  }
  // Only the set-specific page, never navigation/global artwork.
  const pageIndex = raw.findIndex(
    (v) =>
      v &&
      typeof v === "object" &&
      typeof v.metaTitle === "number" &&
      raw[v.metaTitle] === set.name &&
      v.blueprint !== undefined,
  );
  walk(pageIndex >= 0 ? decode(pageIndex) : set);
  if (!products.length)
    throw new Error("No product entries found on the official page.");
  return {
    name: String(set.name),
    products,
    assets: [...assets.values()].slice(0, 150),
  };
}
function key() {
  if (!process.env.JWT_SECRET)
    throw new Error("Server signing key is not configured");
  return process.env.JWT_SECRET;
}
function wpnSourceSlug(code: string, name: string) {
  const aliases: Record<string, string> = {
    tla: "magic-the-gathering-avatar-the-last-airbender",
  };
  return aliases[code] || name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function signPreview(preview: Preview) {
  const data = Buffer.from(JSON.stringify(preview)).toString("base64url");
  return (
    data + "." + createHmac("sha256", key()).update(data).digest("base64url")
  );
}
export function verifyPreview(token: unknown): Preview {
  if (typeof token !== "string" || token.length > 500000)
    throw new Error("Invalid preview");
  const [data, sig] = token.split(".");
  const expected = createHmac("sha256", key()).update(data).digest();
  const received = Buffer.from(sig || "", "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    throw new Error("Preview was modified; search again.");
  const p = JSON.parse(Buffer.from(data, "base64url").toString());
  if (p.expires < Date.now()) throw new Error("Preview expired; search again.");
  return p;
}
export function matchesFoundProduct(
  existing: any,
  p: FoundProduct,
  setName: string,
  code: string,
) {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/decks\b/g, "deck")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return (
    existing.metadata?.wpn_id === p.id ||
    existing.handle === `wpn-${code}-${p.id.toLowerCase()}` ||
    (String(existing.metadata?.set_code || "").toLowerCase() === code &&
      [sealedProductTitle(setName, p.name), `${setName} ${p.name}`, `${sealedSetName(setName)} ${sealedProductTitle(setName, p.name)}`, p.name].some(
        (title) => normalize(existing.title || "") === normalize(title),
      ))
  );
}
async function existingSetProducts(service: any, code: string) {
  const result: any[] = [];
  for (let skip = 0; ; skip += 500) {
    const page = await service.listProducts(
      {},
      { take: 500, skip, order: { id: "ASC" } },
    );
    result.push(
      ...page.filter(
        (p: any) => String(p.metadata?.set_code || "").toLowerCase() === code,
      ),
    );
    if (page.length < 500) return result;
  }
}
async function readUrl(url: string, limit: number) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: { "User-Agent": "BannedCards/1.0 (sealed-catalogue)" },
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Source file is too large");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Source file exceeds download limit");
    }
    chunks.push(value);
  }
  return {
    bytes: Buffer.concat(chunks),
    mime: response.headers.get("content-type")?.split(";")[0] || "",
  };
}
export async function sealedFinder(req: any, res: any, body: any) {
  try {
    const catalog = req.scope.resolve("tcgCatalog");
    const service = req.scope.resolve(Modules.PRODUCT);
    if (["sealed_graphics", "sealed_banner"].includes(body.action)) {
      const code = String(body.code || "").trim().toLowerCase();
      if (!/^[a-z0-9]{2,10}$/.test(code)) throw new Error("Enter a valid set code.");
      const [set] = await catalog.listCardSets({ code }, { take: 1 });
      if (!set) throw new Error("Set not found.");
      const graphics = (set.metadata?.sealed_assets || []).filter((a: any) => a.folder === "graphics");
      if (body.action === "sealed_graphics") {
        res.json({ name: set.name, assets: graphics, banner: set.metadata?.sealed_banner_url || "" });
        return;
      }
      const asset = graphics.find((a: any) => a.id === body.asset_id);
      if (!asset || !/\.(png|jpe?g|webp)(?:\?|$)/i.test(asset.url))
        throw new Error("Choose a saved PNG, JPEG or WebP graphic. Archives and PDFs cannot be banners.");
      await req.scope.resolve(Modules.LOCKING).execute(`cms-sealed-import:${code}`, async () => {
        for (const p of await existingSetProducts(service, code)) {
          if (p.metadata?.kind !== "sealed" && !p.metadata?.wpn_id) continue;
          await req.scope.resolve(Modules.LOCKING).execute(`cms-sealed:${p.id}`, async () => {
            const fresh = await service.retrieveProduct(p.id);
            await service.updateProducts(p.id, { metadata: { ...fresh.metadata, banner_image: asset.url } });
          });
        }
        await req.scope.resolve(Modules.LOCKING).execute(`cms-set:${set.id}`, async () => {
          const fresh = await catalog.retrieveCardSet(set.id);
          await catalog.updateCardSets({ id: set.id, metadata: { ...fresh.metadata, sealed_banner_url: asset.url, sealed_banner_asset_id: asset.id } });
        });
      });
      res.json({ banner: asset.url });
      return;
    }
    if (body.action === "sealed_find") {
      if (body.game !== "magic-the-gathering")
        throw new Error("Only Magic: The Gathering is supported currently.");
      const code = String(body.code || "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9]{2,10}$/.test(code))
        throw new Error("Enter a valid set code.");
      const [set] = await catalog.listCardSets({ code }, { take: 1 });
      if (!set)
        throw new Error(
          "Set code not in the set directory. Import/sync the set first.",
        );
      const slug = wpnSourceSlug(code, String(set.name));
      const source = body.source
        ? String(body.source)
        : `https://wpn.wizards.com/en/products/${slug}`;
      const u = new URL(source);
      if (
        u.origin !== "https://wpn.wizards.com" ||
        !/^\/en\/products\/[a-z0-9-]+$/.test(u.pathname) ||
        u.search ||
        u.hash
      )
        throw new Error("Use an official English WPN product page URL.");
      const { bytes } = await readUrl(source, 12000000);
      const found = parseWpn(bytes.toString("utf8"), code);
      let priceWarning = "";
      try {
        const rateResponse = await readUrl("https://mindicador.cl/api/dolar", 1000000);
        const rate = JSON.parse(rateResponse.bytes.toString()).serie?.[0];
        const age = Date.now() - Date.parse(rate?.fecha);
        if (!Number.isFinite(rate?.valor) || rate.valor <= 0 || !Number.isFinite(age) || age < -86400000 || age > 7 * 86400000) throw new Error("Exchange rate unavailable or outdated");
        for (const p of found.products) {
          if (p.msrp_usd && p.msrp_usd > 0) {
            p.price_clp = Math.round(p.msrp_usd * rate.valor);
            p.price_rate = rate.valor;
            p.price_date = rate.fecha;
          }
        }
      } catch { priceWarning = "CLP conversion unavailable. Products without an estimate will need a manual price."; }
      const existing = await existingSetProducts(service, code);
      found.products.forEach((p) => {
        p.existing = existing.some((e) =>
          matchesFoundProduct(e, p, found.name, code),
        );
      });
      const preview: Preview = {
        ...found,
        game: body.game,
        code,
        setId: set.id,
        source,
        expires: Date.now() + 3600000,
      };
      res.json({ ...preview, priceWarning, token: signPreview(preview) });
      return;
    }
    if (body.action !== "sealed_accept")
      throw new Error("Unknown finder action");
    if (process.env.FILE_STORAGE_DRIVER !== "s3")
      throw new Error("S3 storage must be configured.");
    const preview = verifyPreview(body.token);
    const productIds = Array.isArray(body.products) ? body.products : [];
    const assetIds = Array.isArray(body.assets) ? body.assets : [];
    if (!productIds.length && !assetIds.length)
      throw new Error("Select products or artwork.");
    if (
      productIds.some(
        (id: any) => !preview.products.some((p) => p.id === id),
      ) ||
      assetIds.some((id: any) => !preview.assets.some((a) => a.id === id))
    )
      throw new Error("Selection does not belong to this preview.");
    const results: any[] = [];
    await req.scope
      .resolve(Modules.LOCKING)
      .execute(`cms-sealed-import:${preview.code}`, async () => {
        const [root] = await service.listProductCategories({
          handle: "sealed-products",
        });
        const [channel] = await req.scope
          .resolve(Modules.SALES_CHANNEL)
          .listSalesChannels({}, { take: 1 });
        const [profile] = await req.scope
          .resolve(Modules.FULFILLMENT)
          .listShippingProfiles({}, { take: 1 });
        if (productIds.length && (!root || !channel || !profile))
          throw new Error(
            "Configure sealed categories, sales channel and shipping profile first.",
          );
        const files = req.scope.resolve(Modules.FILE);
        const store = async (source: string, title: string, folder: string) => {
          source = trustedAsset(source);
          // Refresh metadata per file so unrelated set settings are retained.
          const set = await catalog.retrieveCardSet(preview.setId);
          const manifest = Array.isArray(set.metadata?.sealed_assets)
            ? set.metadata.sealed_assets
            : [];
          const id = hash(folder + source);
          const prior = manifest.find((a: any) => a.id === id);
          if (prior) return prior.url;
          const { bytes, mime } = await readUrl(source, 64000000);
          const types: Record<string, string> = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/svg+xml": "svg",
            "application/pdf": "pdf",
            "application/zip": "zip",
            "application/x-zip-compressed": "zip",
            "application/octet-stream": "zip",
          };
          let ext = types[mime];
          if (!ext) throw new Error("Unsupported artwork file type");
          if (ext === "svg")
            throw new Error(
              "SVG artwork requires sanitization; choose raster graphics or an archive.",
            );
          if (ext === "zip" && !(bytes[0] === 80 && bytes[1] === 75))
            throw new Error("Invalid archive");
          const file = await files.createFiles({
            filename: `sealed/${preview.game}/${preview.code}/${folder}/${id}.${ext}`,
            mimeType: mime,
            content: bytes.toString("base64"),
            access: "public",
          });
          await req.scope
            .resolve(Modules.LOCKING)
            .execute(`cms-set:${preview.setId}`, async () => {
              const fresh = await catalog.retrieveCardSet(preview.setId);
              await catalog.updateCardSets({
                id: fresh.id,
                metadata: {
                  ...fresh.metadata,
                  sealed_assets: [
                    ...(fresh.metadata?.sealed_assets || []),
                    {
                      id,
                      title,
                      source,
                      url: file.url,
                      file_id: file.id,
                      folder,
                    },
                  ],
                },
              });
            });
          return file.url;
        };
        for (const p of preview.products.filter((p) =>
          productIds.includes(p.id),
        )) {
          try {
            const handle = `wpn-${preview.code}-${p.id.toLowerCase()}`;
            const existing = await existingSetProducts(service, preview.code);
            if (
              existing.some((e) =>
                matchesFoundProduct(e, p, preview.name, preview.code),
              )
            ) {
              results.push({
                id: p.id,
                title: p.name,
                status: "already exists",
              });
              continue;
            }
            const [category] = await service.listProductCategories({
              handle: `sealed-${p.category}`,
            });
            if (!category) throw new Error("Product category missing");
            const images = [];
            for (const url of p.images)
              images.push({ url: await store(url, p.name, "products") });
            const currentSet = await catalog.retrieveCardSet(preview.setId);
            await createProductsWorkflow(req.scope).run({
              input: {
                products: [
                  {
                    title: sealedProductTitle(preview.name, p.name),
                    handle,
                    status: "draft",
                    thumbnail: images[0].url,
                    images,
                    category_ids: [root.id, category.id],
                    shipping_profile_id: profile.id,
                    sales_channels: await productStoreChannels(req.scope,channel.id),
                    metadata: {
                      banner_image: currentSet.metadata?.sealed_banner_url || "",
                      kind: "sealed",
                      game: preview.game,
                      set: sealedSetName(preview.name),
                      set_code: preview.code,
                      language: "English",
                      wpn_id: p.id,
                      source_sku: p.sku,
                      source_url: preview.source,
                      product_cutout: images[0].url,
                      price_pending: !p.price_clp,
                      price_estimate: p.price_clp ? { basis: "WPN MSRP USD converted to CLP", usd: p.msrp_usd, rate: p.price_rate, rate_date: p.price_date, rate_source: "https://mindicador.cl/api/dolar", source: preview.source } : null,
                    },
                    options: [{ title: "Language", values: ["English"] }],
                    variants: [
                      {
                        title: "English",
                        sku: `WPN-${preview.code}-${p.id}`,
                        manage_inventory: true,
                        allow_backorder: false,
                        options: { Language: "English" },
                        prices: p.price_clp ? [{ currency_code: "clp", amount: p.price_clp }] : [],
                      },
                    ],
                  },
                ],
              },
            });
            results.push({ id: p.id, title: p.name, status: "saved as draft" });
          } catch (e) {
            results.push({
              id: p.id,
              title: p.name,
              status: "failed",
              message: (e as Error).message,
            });
          }
        }
        for (const a of preview.assets.filter((a) => assetIds.includes(a.id))) {
          try {
            const url = await store(a.url, a.title, "graphics");
            results.push({ id: a.id, title: a.title, status: "saved", url });
          } catch (e) {
            results.push({
              id: a.id,
              title: a.title,
              status: "failed",
              message: (e as Error).message,
            });
          }
        }
      });
    res.json({ results });
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });
  }
}
