import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"

type RegionService = {
  listRegions(
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<Array<{ id: string }>>
}

/** Safe to rerun: creates the Chile/CLP region only when it is missing. */
export default async function configureRegion({ container }: ExecArgs) {
  const regions = container.resolve(Modules.REGION) as RegionService
  const [existing] = await regions.listRegions({ currency_code: "clp" }, { take: 1 })

  if (existing) {
    console.log(`Ready: Chile/CLP region (${existing.id})`)
    return
  }

  const { result } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Chile",
          currency_code: "clp",
          countries: ["cl"],
          automatic_taxes: false,
        },
      ],
    },
  })

  console.log(`Created: Chile/CLP region (${result[0].id})`)
}
