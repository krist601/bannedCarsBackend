import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { directory, postSealed, shopSection } from "../lib/cms-sealed"

type Sample = { section: "custom" | "accessories"; group: string; title: string; image: string; price: number; stock: number; description: string }
// Images live in the storefront's public/demo/shop folder (generated locally).
const samples: Sample[] = [
  { section: "accessories", group: "accessories-sleeves", title: "Dragon Shield Matte Sleeves — Black (100)", image: "sleeves-matte-black", price: 8990, stock: 40, description: "Standard-size matte sleeves, 63 × 88 mm, 100 per pack. Sample product." },
  { section: "accessories", group: "accessories-sleeves", title: "Dragon Shield Matte Sleeves — Blue (100)", image: "sleeves-matte-blue", price: 8990, stock: 28, description: "Standard-size matte sleeves, 63 × 88 mm, 100 per pack. Sample product." },
  { section: "accessories", group: "accessories-sleeves", title: "Dragon Shield Dual Matte Sleeves — Lava (100)", image: "sleeves-dual-matte-lava", price: 11990, stock: 18, description: "Dual Matte sleeves with a two-tone finish, 63 × 88 mm, 100 per pack. Sample product." },
  { section: "accessories", group: "accessories-sleeves", title: "Dragon Shield Dual Matte Sleeves — Ink (100)", image: "sleeves-dual-matte-ink", price: 11990, stock: 15, description: "Dual Matte sleeves with a two-tone finish, 63 × 88 mm, 100 per pack. Sample product." },
  { section: "accessories", group: "accessories-dice", title: "Polyhedral Dice Set (7 pcs) — Obsidian", image: "dice-set-obsidian", price: 6990, stock: 30, description: "Seven-piece polyhedral set: d4, d6, d8, d10, d%, d12 and d20. Sample product." },
  { section: "accessories", group: "accessories-dice", title: "Polyhedral Dice Set (7 pcs) — Ruby", image: "dice-set-ruby", price: 6990, stock: 22, description: "Seven-piece polyhedral set: d4, d6, d8, d10, d%, d12 and d20. Sample product." },
  { section: "accessories", group: "accessories-dice", title: "D20 Life Counter — Emerald", image: "dice-d20-life-emerald", price: 2990, stock: 50, description: "Oversized d20 for tracking life totals. Sample product." },
  { section: "custom", group: "custom-decks", title: "Custom Commander Deck — Krenko, Mob Boss (Goblins)", image: "custom-commander-krenko", price: 89990, stock: 3, description: "A ready-to-play 100-card Goblins Commander deck built by our team around Krenko, Mob Boss. Sample product." },
  { section: "custom", group: "custom-decks", title: "Custom Commander Deck — Atraxa, Praetors' Voice (Superfriends)", image: "custom-commander-atraxa", price: 119990, stock: 2, description: "A ready-to-play 100-card Commander deck built by our team around Atraxa, Praetors' Voice. Sample product." },
  { section: "custom", group: "custom-token-packs", title: "Custom Token Pack — Goblins, Treasures & Elementals", image: "custom-token-pack", price: 5990, stock: 25, description: "A pack of 30 tokens chosen by us for the most popular token decks. Sample product." },
]

/** Safe to rerun: skips products whose title already exists. Uses the same code path as the CMS. */
export default async function seedDemoShopSections({ container }: ExecArgs) {
  const [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: "Banned Cards Warehouse" }, { take: 1 })
  if (!location) throw new Error("Warehouse 'Banned Cards Warehouse' not found.")
  const products = container.resolve(Modules.PRODUCT)
  const respond = () => {
    const out: { code: number; body: any } = { code: 200, body: null }
    const res = { status(code: number) { out.code = code; return res }, json(body: any) { out.body = body; return res } }
    return { out, res }
  }
  for (const sample of samples) {
    const [existing] = await products.listProducts({ title: sample.title }, { take: 1, relations: ["variants"] })
    if (existing) { console.log(`Already exists: ${sample.title}`); continue }
    const { categories } = await directory(container, shopSection(sample.section))
    const category = categories.find((c: any) => c.handle === sample.group)
    if (!category) throw new Error(`Group ${sample.group} not found.`)
    const created = respond()
    await postSealed({ scope: container }, created.res, {
      action: "sealed_create", section: sample.section, title: sample.title, status: "published", description: sample.description,
      thumbnail: `/demo/shop/${sample.image}.png`, category_id: category.id, price_clp: sample.price,
    })
    if (created.out.code >= 400) throw new Error(`${sample.title}: ${created.out.body?.message}`)
    const [product] = await products.listProducts({ title: sample.title }, { take: 1, relations: ["variants"] })
    await products.updateProducts(product.id, { metadata: { ...product.metadata, demo_inventory: true, image_url: `/demo/shop/${sample.image}.png`, product_cutout: `/demo/shop/${sample.image}.png` } })
    const stocked = respond()
    await postSealed({ scope: container }, stocked.res, {
      action: "sealed_stock", section: sample.section, product_id: product.id, variant_id: product.variants![0].id,
      location_id: location.id, quantity: sample.stock,
    })
    if (stocked.out.code >= 400) throw new Error(`${sample.title} stock: ${stocked.out.body?.message}`)
    console.log(`Created ${sample.title}: CLP ${sample.price}, stock ${sample.stock}`)
  }
}
