export type CataloguePrinting = {
  id: string
  set_id: string
  collector_number: string
  name: string
  rarity?: string | null
  external_id?: string | null
  image_url?: string | null
  image_small_url?: string | null
  attributes?: Record<string, unknown> | null
}

export type CatalogueSet = { id: string; code: string; name: string }
export type CatalogueListing = {
  id: string
  printing_id: string
  variant_id?: string | null
  condition?: string | null
  language?: string | null
  finish?: string | null
  price_clp: number
  quantity: number
}

const titleCase = (value: string) => value.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")

function cardImages(printing: CataloguePrinting) {
  const attributes = printing.attributes ?? {}
  return {
    normal: typeof attributes.image_storage_url === "string" ? attributes.image_storage_url : null,
    small: typeof attributes.image_small_storage_url === "string" ? attributes.image_small_storage_url : null
  }
}

export function projectCardCatalogue(
  printings: CataloguePrinting[],
  sets: CatalogueSet[],
  listings: CatalogueListing[]
) {
  const setById = new Map(sets.map(set => [set.id, set]))
  const listingsByPrinting = new Map<string, CatalogueListing[]>()
  for (const listing of listings) {
    const group = listingsByPrinting.get(listing.printing_id) ?? []
    group.push(listing)
    listingsByPrinting.set(listing.printing_id, group)
  }

  return printings.flatMap(printing => {
    const set = setById.get(printing.set_id)
    const images = cardImages(printing)
    const printingListings = listingsByPrinting.get(printing.id)
    const rows: Array<CatalogueListing | null> = printingListings?.length ? printingListings : [null]
    const scryfallData = printing.attributes?.scryfall_data
    const colors = scryfallData && typeof scryfallData === "object" && Array.isArray((scryfallData as Record<string, unknown>).colors)
      ? ((scryfallData as Record<string, unknown>).colors as unknown[]).filter(value => typeof value === "string").join("")
      : ""

    return rows.map(listing => {
      const isSellable = Boolean(listing?.variant_id)
      return {
        id: listing?.variant_id ?? `printing:${printing.id}`,
        printing_id: printing.id,
        listing_id: listing?.id ?? null,
        variant_id: listing?.variant_id ?? null,
        name: printing.name,
        set: set?.name ?? "Unknown set",
        set_code: set?.code ?? "",
        collector_number: printing.collector_number,
        rarity: printing.rarity ?? null,
        condition: listing?.condition ? titleCase(listing.condition) : "Not listed",
        language: listing?.language ?? null,
        finish: listing?.finish ? titleCase(listing.finish).replace("Non Foil", "Non-foil") : "Standard",
        price_clp: listing?.price_clp ?? null,
        stock: isSellable ? Math.max(0, listing?.quantity ?? 0) : 0,
        image_url: images.normal,
        image_small_url: images.small,
        colors,
        collection: set?.code.toLowerCase() === "ltr" ? "Middle-earth" : "Latest",
        external_id: printing.external_id ?? null
      }
    })
  })
}
