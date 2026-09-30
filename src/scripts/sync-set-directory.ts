import type { ExecArgs } from "@medusajs/framework/types"
import { syncSetDirectory } from "../lib/sync-set-directory"
export default async function syncSets({ container }: ExecArgs) { await syncSetDirectory(container) }
