// The ONE place that removes anything under <data>/projects. Each project's workspace is blocked in the runner first
// (every launch path refuses it, and the engine confirms its container is gone); only then is its folder moved into the
// trash, out of every mount. There it is emptied by the runner's cleaning container, which runs as the workspace user
// with only that folder mounted (code in a workspace owns what it creates and may make it owner-only, which the hub, a
// different uid, could not remove), and the hub removes what is left without following links. With the process runner
// (one uid) the hub removes it itself. A removal that fails leaves the folder in the trash, still counted in the user's
// usage, writes it to the audit log, and is retried by the hub's sweep. If any block fails, nothing is moved and the
// error says so. A test (hub-project-folders.test.ts) checks that no other file in src/hub removes from the projects tree.
import type { Hub } from "./context.js"

type FoldersHub = Pick<Hub, "runner" | "files"> & Partial<Pick<Hub, "store" | "log" | "config">>

/** The first retry of a failed trash removal, doubling up to the longest. */
export const TRASH_RETRY_FIRST_MS = 5_000
export const TRASH_RETRY_MAX_MS = 10 * 60_000

export interface TrashFailure {
  path: string
  userId: string
  failures: number
  nextAt: number
  reason: string
}

/** Trash folders whose removal failed, with when to try again (in this hub process). */
const failures = new Map<string, TrashFailure>()

/** Trash removals that failed more than `min` times, for `hub status`. */
export function trashFailures(min = 0): TrashFailure[] {
  return [...failures.values()].filter((failure) => failure.failures > min)
}

/**
 * Empties and removes one folder in the trash with both hands: what the hub owns there is given the workspace group,
 * the cleaning container (the workspace's uid) removes what it can, then the hub removes what is left that it owns,
 * then the empty folder. Either alone is not expected to finish. False (left in the trash, still charged, audited, and
 * retried with a growing delay) when the folder is not gone.
 */
export async function emptyTrash(hub: FoldersHub, userId: string, parked: string, now: () => number = Date.now): Promise<boolean> {
  let reason = "the folder is still there after both removals"
  try {
    await hub.files.openParked(parked)
    if (hub.runner.cleanFolder) await hub.runner.cleanFolder(parked).catch((error: Error) => void (reason = error.message))
    if (await hub.files.removeParked(parked)) {
      failures.delete(parked)
      return true
    }
  } catch (error) {
    reason = (error as Error).message
  }
  const before = failures.get(parked)
  const count = (before?.failures ?? 0) + 1
  const delay = Math.min(TRASH_RETRY_MAX_MS, TRASH_RETRY_FIRST_MS * 2 ** (count - 1))
  failures.set(parked, { path: parked, userId, failures: count, nextAt: now() + delay, reason: reason.slice(0, 200) })
  hub.log?.(`trash folder of user ${userId} could not be removed yet (${count} attempt(s)): ${reason.slice(0, 200)}`)
  try {
    hub.store?.audit({ time: hub.config?.now() ?? now(), userId, event: "trash-removal-failed", address: "hub", detail: `attempt ${count}; retried in ${Math.round(delay / 1000)} s` })
  } catch {
    // The audit log failing must not hide the failure; the folder stays in the trash and counts.
  }
  return false
}

async function blockAll(hub: FoldersHub, ids: readonly string[]): Promise<string[]> {
  const blocked: string[] = []
  try {
    for (const id of ids) {
      await hub.runner.block(id)
      blocked.push(id)
    }
    return blocked
  } catch (error) {
    for (const id of blocked) hub.runner.unblock(id)
    throw error
  }
}

/**
 * Blocks each project, moves its folder to the trash, empties it there, and releases the blocks. `afterBlocked` (such
 * as marking the project deleted) runs only once every block holds: a refused block changes nothing.
 */
export async function removeProjectFolders(hub: FoldersHub, userId: string, ids: readonly string[], afterBlocked: () => void = () => undefined): Promise<void> {
  const blocked = await blockAll(hub, ids)
  try {
    afterBlocked()
    const parked: string[] = []
    for (const id of ids) {
      const moved = await hub.files.moveToTrash(userId, hub.files.projectDir(userId, id))
      if (moved) parked.push(moved)
    }
    for (const path of parked) await emptyTrash(hub, userId, path)
  } finally {
    for (const id of blocked) hub.runner.unblock(id)
  }
}

/** Removes every project folder of the user as above, then the user's own folder. */
export async function removeUserFolders(hub: FoldersHub, userId: string, ids: readonly string[]): Promise<void> {
  const blocked = await blockAll(hub, ids)
  try {
    const parked: string[] = []
    for (const id of ids) {
      const moved = await hub.files.moveToTrash(userId, hub.files.projectDir(userId, id))
      if (moved) parked.push(moved)
    }
    const rest = await hub.files.moveToTrash(userId, hub.files.userDir(userId))
    if (rest) parked.push(rest)
    for (const path of parked) await emptyTrash(hub, userId, path)
  } finally {
    for (const id of blocked) hub.runner.unblock(id)
  }
}

/** The sweep's retry of every folder still in the trash whose delay has passed; how many are left. */
export async function retryTrash(hub: FoldersHub, now: () => number = Date.now): Promise<number> {
  let left = 0
  for (const { userId, path } of await hub.files.allTrash()) {
    const failed = failures.get(path)
    if (failed && failed.nextAt > now()) {
      left += 1
      continue
    }
    if (!(await emptyTrash(hub, userId, path, now))) left += 1
  }
  return left
}

/** A staging folder older than this was left by an upload a crash interrupted. */
export const STALE_STAGING_MS = 60 * 60_000
/** A project folder with no row is an orphan only when its last change is older than this (never an upload mid-way). */
export const ORPHAN_AGE_MS = 10 * 60_000

/**
 * Crash leftovers (at hub start and in the sweep): staging folders older than an hour are removed, and a folder under
 * the projects tree with no row (an upload placed but never given one) goes through removeProjectFolders. Both are
 * written to the audit log.
 */
export async function sweepOrphans(hub: FoldersHub & Pick<Hub, "store">, now: () => number = Date.now): Promise<void> {
  const audit = (userId: string | null, event: string, detail: string) => {
    try {
      hub.store.audit({ time: now(), userId, event, address: "hub", detail })
    } catch {
      // Logged below either way.
    }
  }
  for (const path of await hub.files.staleStaging(STALE_STAGING_MS, now())) {
    await hub.files.discard(path)
    audit(null, "stale-upload-removed", "a staging folder older than an hour")
  }
  for (const { userId, projectId } of await hub.files.projectFolders()) {
    if (hub.store.projectIds(userId).includes(projectId)) continue
    if (!(await hub.files.olderThan(hub.files.projectDir(userId, projectId), ORPHAN_AGE_MS, now()))) continue
    try {
      await removeProjectFolders(hub, userId, [projectId])
      audit(userId, "orphan-folder-removed", projectId)
    } catch (error) {
      hub.log?.(`orphan folder ${projectId} could not be removed yet: ${(error as Error).message}`)
    }
  }
}

/**
 * Projects marked deleted whose removal did not finish (a refused or failed earlier attempt, a crash): removed again,
 * and their rows deleted once their folders are gone from the projects tree.
 */
export async function retryDeletedProjects(hub: FoldersHub & Pick<Hub, "store">): Promise<void> {
  for (const { id, userId } of hub.store.deletedProjects()) {
    try {
      await removeProjectFolders(hub, userId, [id])
      hub.store.deleteProject(userId, id)
    } catch (error) {
      hub.log?.(`deleted project ${id} could not be removed yet: ${(error as Error).message}`)
    }
  }
}
