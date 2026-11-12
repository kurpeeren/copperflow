// What keeps a project folder's contents safe from its own workspace, and the disk quota while workspaces run.
//
// The hub never reads a project's file CONTENTS while its workspace runs: a download (or a deletion) first takes the
// project's lock, which stops the workspace and refuses to start it until the work is done. With the container gone
// nothing can swap a folder for a link under the hub (Node has no openat, so the race cannot be won by checking).
//
// The quota is per user. Every 5 s the hub measures each user with a running workspace (lstat only, never opening a
// file: safe-files.ts measureTree); a user over quota, or whose measurement fails, is capped or is discarded for a
// folder that moved outside the project, has all their running workspaces stopped. Before ANY workspace starts the
// user is measured again, and none starts while they are over. What this does not stop: a workspace can write as fast
// as the disk allows for up to one sweep interval past the quota (docs/hosted.md, "Running the hub").
import type { Hub } from "./context.js"
import type { Measured } from "./safe-files.js"

/** How often running workspaces are measured: 5 s. */
export const QUOTA_SWEEP_MS = 5_000

export const OVER_QUOTA_MESSAGE =
  "Your projects use more disk space than the plan allows, so none of them opens until you are under the limit. Download or delete projects on the projects page (the largest are listed first)."
export const BUSY_MESSAGE = "The project is being downloaded or deleted. It opens again in a moment."

/** Refused because the user is over their disk quota (or could not be measured). */
export class OverQuotaError extends Error {
  constructor() {
    super(OVER_QUOTA_MESSAGE)
  }
}

/** Refused because the project is locked for a download or deletion. */
export class ProjectBusyError extends Error {
  constructor() {
    super(BUSY_MESSAGE)
  }
}

type QuotaHub = Pick<Hub, "runner" | "store" | "files" | "config" | "log">

/** Locked projects, per hub (keyed by its runner, which every hub has). */
const locks = new WeakMap<object, Set<string>>()

function lockedSet(hub: Pick<Hub, "runner">): Set<string> {
  let set = locks.get(hub.runner)
  if (!set) {
    set = new Set()
    locks.set(hub.runner, set)
  }
  return set
}

export function isLocked(hub: Pick<Hub, "runner">, projectId: string): boolean {
  return lockedSet(hub).has(projectId)
}

/**
 * Runs `work` with the project's workspace stopped and unable to start; the lock is released however `work` ends.
 * Throws ProjectBusyError when the project is locked already.
 */
export async function withProjectLock<T>(hub: Pick<Hub, "runner">, projectId: string, work: () => Promise<T>): Promise<T> {
  const set = lockedSet(hub)
  if (set.has(projectId)) throw new ProjectBusyError()
  set.add(projectId)
  try {
    await hub.runner.stop(projectId)
    return await work()
  } finally {
    set.delete(projectId)
  }
}

/** Over quota: over the bytes, or not measured at all (a failure never counts as room). */
function over(hub: QuotaHub, measured: Measured): boolean {
  return "failed" in measured || measured.bytes > hub.config.maxBytes
}

/** Stops every running workspace of each user over quota; the ids it stopped. One user's failure never stops the sweep. */
export async function sweepQuota(hub: QuotaHub): Promise<string[]> {
  const byUser = new Map<string, string[]>()
  for (const { id, userId } of hub.runner.active()) byUser.set(userId, [...(byUser.get(userId) ?? []), id])
  const stopped: string[] = []
  for (const [userId, ids] of byUser) {
    let measured: Measured
    try {
      measured = await hub.files.measureUser(userId)
    } catch (error) {
      measured = { failed: `the measurement failed (${(error as NodeJS.ErrnoException).code ?? "error"})` }
    }
    if (!over(hub, measured)) continue
    for (const id of ids) {
      await hub.runner.stop(id).catch(() => undefined)
      stopped.push(id)
    }
    // Only the byte count or the reason, which names no path.
    const detail = "failed" in measured ? `not measured: ${measured.failed}` : `${measured.bytes} bytes`
    try {
      hub.store.audit({ time: hub.config.now(), userId, event: "over-quota-stop", address: "hub", detail: `${ids.length} workspace(s), ${detail}`.slice(0, 200) })
    } catch {
      // The audit log failing must not keep the next user from being measured.
    }
    hub.log(`user ${userId} is over the disk quota (${detail}); stopped ${ids.length} workspace(s)`)
  }
  return stopped
}

/** Before any workspace of the user starts: the project is not locked, and the user is under quota. */
export async function checkBeforeStart(hub: QuotaHub, userId: string, projectId: string): Promise<void> {
  const measured = await hub.files.measureUser(userId).catch((): Measured => ({ failed: "the measurement failed" }))
  if (over(hub, measured)) throw new OverQuotaError()
  // Checked last, with no wait between it and the caller's ensure: a lock taken while measuring is seen here.
  if (isLocked(hub, projectId)) throw new ProjectBusyError()
}
