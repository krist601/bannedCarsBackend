import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

const warehouses = [
  { name: "Kristian's", isDefault: true },
  { name: "Samuel's", isDefault: false },
  { name: "Shared", isDefault: false },
]

/** Safe to rerun: creates missing warehouses and links each one to the store channel. */
export default async function configureWarehouses({ container }: ExecArgs) {
  const locations = container.resolve(Modules.STOCK_LOCATION)
  const channels = container.resolve(Modules.SALES_CHANNEL)
  const [channel] = await channels.listSalesChannels({}, { take: 1 })

  if (!channel) throw new Error("Configure a sales channel first.")

  for (const warehouse of warehouses) {
    let [location] = await locations.listStockLocations(
      { name: warehouse.name },
      { take: 1 },
    )

    if (!location) {
      location = (
        await createStockLocationsWorkflow(container).run({
          input: {
            locations: [
              {
                name: warehouse.name,
                address: {
                  address_1: "Banned Cards",
                  city: "Santiago",
                  country_code: "cl",
                },
                metadata: { is_default: warehouse.isDefault },
              },
            ],
          },
        })
      ).result[0]
    }

    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [channel.id], remove: [] },
    })
    console.log(`Ready: ${warehouse.name}${warehouse.isDefault ? " (default)" : ""}`)
  }
}
