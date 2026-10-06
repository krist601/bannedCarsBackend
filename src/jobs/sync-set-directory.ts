import { withBackupActivity } from "../lib/database-backups"
import type { MedusaContainer } from "@medusajs/framework/types"
import { syncSetDirectory } from "../lib/sync-set-directory"
export default async function syncSetsJob(container: MedusaContainer) { await withBackupActivity(() => syncSetDirectory(container)) }
export const config = { name: "sync-set-directory", schedule: "0 6 * * *" }
