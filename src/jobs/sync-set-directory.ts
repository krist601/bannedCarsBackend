import type { MedusaContainer } from "@medusajs/framework/types"
import { syncSetDirectory } from "../lib/sync-set-directory"
export default async function syncSetsJob(container: MedusaContainer) { await syncSetDirectory(container) }
export const config = { name: "sync-set-directory", schedule: "0 6 * * *" }
