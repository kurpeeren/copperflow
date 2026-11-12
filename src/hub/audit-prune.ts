// The audit log keeps 180 days and at most 500 000 rows, oldest deleted first. The sweep prunes in bounded batches (one
// statement each, with the event loop given back in between) so it never holds the database for long.
import type { HubStore } from "./store.js"

export const AUDIT_KEEP_MS = 180 * 24 * 60 * 60_000
export const AUDIT_MAX_ROWS = 500_000
/** Rows one delete statement removes. */
const BATCH_ROWS = 2_000
/** Batches one sweep runs; a larger backlog is finished by the next sweeps. */
const BATCHES_PER_SWEEP = 25

export interface PruneOptions {
  batch?: number
  maxBatches?: number
}

/** Prunes the audit log at time `now`; returns how many rows went. */
export async function pruneAudit(store: HubStore, now: number, options: PruneOptions = {}): Promise<number> {
  const batch = options.batch ?? BATCH_ROWS
  const maxBatches = options.maxBatches ?? BATCHES_PER_SWEEP
  let total = 0
  for (let round = 0; round < maxBatches; round += 1) {
    const removed = store.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, batch)
    total += removed
    if (removed < batch) break
    await new Promise<void>((done) => setImmediate(done))
  }
  return total
}
