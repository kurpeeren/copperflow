// What keeps a project folder's contents safe from its own workspace, and the disk quota while workspaces run.
//
// The hub never reads a project's file contents while its workspace runs: a download (or a deletion) first blocks the
// project IN THE RUNNER (runner.block), which refuses every launch path, stops the workspace and confirms with the
// engine that its container is gone. With the container gone nothing can swap a folder for a link under the hub (Node
// has no openat, so the race cannot be won by checking).
//
// The quota is per user, in bytes and in entries. Every 5 s the hub measures each user with a running workspace
// (lstat only, never opening a file: safe-files.ts measureTree), 4 users at a time; a user over quota, or whose
// measurement fails, is capped or is discarded, has all their running workspaces stopped. The runner asks the same
// question immediately before every launch. Measurements are cached per user for 5 s and shared while in flight, so a
// burst of requests costs one walk. What this does not stop: a workspace can write as fast as the disk allows for up to
// about one sweep interval past the quota (docs/hosted.md, "Running the hub").
import type { Hub } from "./context.js"
import { StartRefused, type WorkspaceSpec } from "./runner/runner.js"
import type { Measured } from "./safe-files.js"

export { ProjectBusyError, StopUnconfirmedError } from "./runner/runner.js"

/** How often running workspaces are measured: 5 s. */
export const QUOTA_SWEEP_MS = 5_000
/** How long one user's measurement is reused. */
export const MEASURE_CACHE_MS = 5_000
/** Users measured at once by the sweep. */
export const SWEEP_CONCURRENCY = 4
/** The time one user's measurement may take in the sweep. */
export const SWEEP_USER_MS = 2_000
/** The most entries (files and folders) one user's projects may hold. */
export const MAX_ENTRIES_PER_USER = 20_000

export const OVER_QUOTA_MESSAGE = `Your projects use more disk space (or more than ${MAX_ENTRIES_PER_USER} files and folders) than the plan allows, so none of them opens until you are under the limit. Download or delete projects on the projects page (the largest are listed first).`

/** Refused because the user is over their disk quota (or could not be measured). */
export class OverQuotaError extends StartRefused {
  constructor() {
    super(OVER_QUOTA_MESSAGE)
  }
}

type QuotaHub = Pick<Hub, "runner" | "store" | "files" | "config" | "log">

interface Cached {
  at: number
  measured: Promise<Measured>
}

const caches = new WeakMap<object, Map<string, Cached>>()

/** The user's measurement: reused for 5 s, and shared by everyone asking while it runs. */
export function measureUser(hub: Pick<Hub, "runner" | "files">, userId: string, maxMs?: number): Promise<Measured> {
  let cache = caches.get(hub.runner)
  if (!cache) {
    cache = new Map()
    caches.set(hub.runner, cache)
  }
  const now = Date.now()
  const known = cache.get(userId)
  if (known && now - known.at < MEASURE_CACHE_MS) return known.measured
  const measured = hub.files
    .measureUser(userId, { maxEntries: MAX_ENTRIES_PER_USER, ...(maxMs !== undefined ? { maxMs } : {}) })
    .catch((error: NodeJS.ErrnoException): Measured => ({ failed: `the measurement failed (${error.code ?? "error"})` }))
  cache.set(userId, { at: now, measured })
  return measured
}

/** Forgets a user's cached measurement (after the person deleted projects, or before the sweep measures afresh). */
export function forgetMeasurement(hub: Pick<Hub, "runner">, userId: string): void {
  caches.get(hub.runner)?.delete(userId)
}

/** Over quota: over the bytes, or not measured at all (a failure, a cap, a discarded walk never counts as room). */
export function isOver(hub: Pick<Hub, "config">, measured: Measured): boolean {
  return "failed" in measured || measured.bytes > hub.config.maxBytes
}

/** The check the runner makes immediately before every launch. */
export async function canStart(hub: QuotaHub, spec: WorkspaceSpec): Promise<void> {
  if (isOver(hub, await measureUser(hub, spec.userId))) throw new OverQuotaError()
}

/** Installs the quota as the runner's start check. */
export function installStartCheck(hub: QuotaHub): void {
  hub.runner.setStartCheck((spec) => canStart(hub, spec))
}

/** Runs `work` with the project blocked in the runner (its workspace confirmed gone); released however `work` ends. */
export async function withProjectLock<T>(hub: Pick<Hub, "runner">, projectId: string, work: () => Promise<T>): Promise<T> {
  await hub.runner.block(projectId)
  try {
    return await work()
  } finally {
    hub.runner.unblock(projectId)
  }
}

async function sweepUser(hub: QuotaHub, userId: string, ids: string[]): Promise<string[]> {
  forgetMeasurement(hub, userId)
  const measured = await measureUser(hub, userId, SWEEP_USER_MS)
  if (!isOver(hub, measured)) return []
  for (const id of ids) await hub.runner.stop(id).catch(() => undefined)
  // Only the byte count or the reason, which names no path.
  const detail = "failed" in measured ? `not measured: ${measured.failed}` : `${measured.bytes} bytes`
  try {
    hub.store.audit({ time: hub.config.now(), userId, event: "over-quota-stop", address: "hub", detail: `${ids.length} workspace(s), ${detail}`.slice(0, 200) })
  } catch {
    // The audit log failing must not keep the next user from being measured.
  }
  hub.log(`user ${userId} is over the disk quota (${detail}); stopped ${ids.length} workspace(s)`)
  return ids
}

/** Stops every running workspace of each user over quota, 4 users at a time; one user's failure never stops the rest. */
export async function sweepQuota(hub: QuotaHub): Promise<string[]> {
  const byUser = new Map<string, string[]>()
  for (const { id, userId } of hub.runner.active()) byUser.set(userId, [...(byUser.get(userId) ?? []), id])
  const queue = [...byUser]
  const stopped: string[] = []
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [userId, ids] = next
      stopped.push(...(await sweepUser(hub, userId, ids).catch(() => [])))
    }
  }
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, queue.length) }, worker))
  return stopped
}
