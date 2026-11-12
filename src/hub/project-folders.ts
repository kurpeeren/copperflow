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

/** Empties and removes one folder in the trash; false (left in the trash, audited) when that failed. */
export async function emptyTrash(hub: FoldersHub, userId: string, parked: string): Promise<boolean> {
  try {
    if (hub.runner.cleanFolder) await hub.runner.cleanFolder(parked)
    await hub.files.removeParked(parked)
    return true
  } catch (error) {
    hub.log?.(`trash folder of user ${userId} could not be removed yet: ${(error as Error).message}`)
    try {
      hub.store?.audit({ time: hub.config?.now() ?? Date.now(), userId, event: "trash-removal-failed", address: "hub", detail: "retried by the sweep" })
    } catch {
      // The audit log failing must not hide the failure; the folder stays in the trash and counts.
    }
    return false
  }
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

/** Blocks each project, moves its folder to the trash, empties it there, and releases the blocks. */
export async function removeProjectFolders(hub: FoldersHub, userId: string, ids: readonly string[]): Promise<void> {
  const blocked = await blockAll(hub, ids)
  try {
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

/** The sweep's retry of every folder still in the trash; how many are left. */
export async function retryTrash(hub: FoldersHub): Promise<number> {
  let left = 0
  for (const { userId, path } of await hub.files.allTrash()) if (!(await emptyTrash(hub, userId, path))) left += 1
  return left
}
