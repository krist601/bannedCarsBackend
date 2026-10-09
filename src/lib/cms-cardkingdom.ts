import { withBackupActivity } from "./database-backups";
import { syncCardKingdomPrices, lastCardKingdomSync } from "./cardkingdom-prices";

type State = { running: boolean; started_at: string | null; finished_at: string | null; sets: number | null; matched: number | null; updated: number | null; error: string | null };
const state: State = { running: false, started_at: null, finished_at: null, sets: null, matched: null, updated: null, error: null };

/** Starts the Card Kingdom price download in the background (one at a time) and returns the current status. */
export function startCardKingdomSync(scope: any): State {
  if (state.running) return { ...state };
  Object.assign(state, { running: true, started_at: new Date().toISOString(), finished_at: null, sets: null, matched: null, updated: null, error: null });
  void withBackupActivity(async () => {
    const result = await syncCardKingdomPrices(scope);
    Object.assign(state, { sets: result.sets, matched: result.matched, updated: result.updated });
  })
    .catch((error) => { state.error = (error as Error).message; })
    .finally(() => { state.running = false; state.finished_at = new Date().toISOString(); });
  return { ...state };
}
export async function cardKingdomSyncStatus(scope: any) {
  return { ...state, last: await lastCardKingdomSync(scope).catch(() => null) };
}
