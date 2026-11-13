// The audit log keeps 180 days. Age is the only rule that deletes a security event. Above 500 000 rows only routine rows
// are deleted (oldest first), so one user flooding routine rows can push out nobody's security events; if the log is
// still over the cap with no routine row left, nothing is deleted and `hub status` says so. The sweep prunes in bounded
// batches (one statement each, the event loop given back in between) so it never holds the database for long.
import type { HubStore } from "./store.js"

export const AUDIT_KEEP_MS = 180 * 24 * 60 * 60_000
export const AUDIT_MAX_ROWS = 500_000
/**
 * The routine kinds, the one list that decides a kind's class: every other kind is a security event and is kept by
 * default (so a new kind is safe until someone lists it here). `audit-suppressed` is the note that a routine kind was
 * cut off for a user's window.
 */
export const ROUTINE_AUDIT_KINDS: readonly string[] = ["workspace-entered", "tool-calls-limited", "audit-suppressed"]
/** Rows one delete statement removes. */
const BATCH_ROWS = 2_000
/** Batches one sweep runs; a larger backlog is finished by the next sweeps. */
const BATCHES_PER_SWEEP = 25
const DAY_MS = 24 * 60 * 60_000

export interface PruneOptions {
  batch?: number
  maxBatches?: number
  /** Where the once-a-day "over the cap" line goes. */
  log?: (line: string) => void
}

const lastOverCapLine = new WeakMap<HubStore, number>()

/** Prunes the audit log at time `now`; returns how many rows went. */
export async function pruneAudit(store: HubStore, now: number, options: PruneOptions = {}): Promise<number> {
  const batch = options.batch ?? BATCH_ROWS
  const maxBatches = options.maxBatches ?? BATCHES_PER_SWEEP
  let total = 0
  let removed = 0
  for (let round = 0; round < maxBatches; round += 1) {
    removed = store.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, batch, ROUTINE_AUDIT_KINDS)
    total += removed
    if (removed < batch) break
    await new Promise<void>((done) => setImmediate(done))
  }
  // Nothing more may be deleted, yet the log is over the cap: say so, once a day.
  if (removed === 0 && options.log && store.auditOverCap(AUDIT_MAX_ROWS) && now - (lastOverCapLine.get(store) ?? Number.NEGATIVE_INFINITY) >= DAY_MS) {
    lastOverCapLine.set(store, now)
    options.log(`the audit log holds ${store.auditRowCount()} rows, over its ${AUDIT_MAX_ROWS} cap, and only security events are left that may not be deleted before they are 180 days old`)
  }
  return total
}
