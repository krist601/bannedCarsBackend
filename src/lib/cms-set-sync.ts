import { withBackupActivity } from "./database-backups";
import { syncSetDirectory } from "./sync-set-directory";

type SyncState = { running: boolean; started_at: string | null; finished_at: string | null; sets: number | null; icon_failures: number | null; error: string | null };
const state: SyncState = { running: false, started_at: null, finished_at: null, sets: null, icon_failures: null, error: null };

/** Starts the Scryfall set + icon sync in the background (one at a time) and returns the current status. */
export function startSetSync(container: any): SyncState {
  if (state.running) return { ...state };
  Object.assign(state, { running: true, started_at: new Date().toISOString(), finished_at: null, sets: null, icon_failures: null, error: null });
  void withBackupActivity(async () => {
    const result = await syncSetDirectory(container);
    state.sets = result.sets;
    state.icon_failures = result.iconFailures;
  })
    .catch((error) => { state.error = (error as Error).message; })
    .finally(() => { state.running = false; state.finished_at = new Date().toISOString(); });
  return { ...state };
}
export const setSyncStatus = (): SyncState => ({ ...state });
