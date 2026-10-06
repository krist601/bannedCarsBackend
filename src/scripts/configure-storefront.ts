import { chmod, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ApiKeyType, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow
} from "@medusajs/medusa/core-flows"

type RegionService = {
  listRegions(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string }>>
}
type SalesChannelService = {
  listSalesChannels(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string }>>
}
type UserService = {
  listUsers(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string }>>
}

function environmentPath(args: string[]) {
  const value = process.env.STOREFRONT_ENV_PATH
    ?? args.find(argument => argument.startsWith("env=") || argument.startsWith("--env="))?.split("=", 2)[1]
  if (!value) throw new Error("Set STOREFRONT_ENV_PATH to the frontend .env.local path")
  return resolve(value)
}

function readValue(contents: string, name: string) {
  return contents.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() || null
}

export default async function configureStorefront({ container, args }: ExecArgs) {
  const target = environmentPath(args)
  const existing = await readFile(target, "utf8").catch(() => "")
  const regions = container.resolve(Modules.REGION) as RegionService
  const [region] = await regions.listRegions({ currency_code: "clp" }, { take: 1 })
  const regionId = region?.id ?? (await createRegionsWorkflow(container).run({
    input: { regions: [{ name: "Chile", currency_code: "clp", countries: ["cl"], automatic_taxes: false }] }
  })).result[0].id

  let publishableKey = readValue(existing, "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")
  if (!publishableKey) {
    const users = container.resolve(Modules.USER) as UserService
    const [user] = await users.listUsers({}, { take: 1 })
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: "Banned Cards Storefront", type: ApiKeyType.PUBLISHABLE, created_by: user?.id ?? "system" }] }
    })
    publishableKey = result[0].token

    const salesChannels = container.resolve(Modules.SALES_CHANNEL) as SalesChannelService
    const [store] = await container.resolve(Modules.STORE).listStores()
    const channels = await salesChannels.listSalesChannels({id:store.default_sales_channel_id}, { take: 1 })
    if (channels.length) {
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: result[0].id, add: channels.map(channel => channel.id), remove: [] }
      })
    }
  }

  await writeFile(target, [
    "NEXT_PUBLIC_COMMERCE_MODE=medusa",
    "NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000",
    `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${publishableKey}`,
    `NEXT_PUBLIC_MEDUSA_REGION_ID=${regionId}`,
    ""
  ].join("\n"), { mode: 0o600 })
  await chmod(target, 0o600)
  console.log(`Configured Medusa storefront mode, a CLP region, and a publishable key in ${target}`)
}
