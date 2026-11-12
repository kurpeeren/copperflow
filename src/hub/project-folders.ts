// The ONE place that removes anything under <data>/projects. Each project's workspace is blocked in the runner first
// (every launch path refuses it, and the engine confirms its container is gone); only then is its folder moved into the
// trash, out of every mount, and removed there without following links. If any block fails, nothing is removed and the
// error says so. The blocks are held until the folders are gone. A test (hub-project-folders.test.ts) checks that no
// other file in src/hub removes anything from the projects tree.
import type { Hub } from "./context.js"

type FoldersHub = Pick<Hub, "runner" | "files">

/** Blocks each project, removes its folder via the trash, and releases the blocks; throws (removing nothing) if any block fails. */
export async function removeProjectFolders(hub: FoldersHub, userId: string, ids: readonly string[]): Promise<void> {
  const blocked: string[] = []
  try {
    for (const id of ids) {
      await hub.runner.block(id)
      blocked.push(id)
    }
    for (const id of ids) await hub.files.remove(userId, id)
  } finally {
    for (const id of blocked) hub.runner.unblock(id)
  }
}

/** Removes every project folder of the user as above, then the user's (now empty) folder. */
export async function removeUserFolders(hub: FoldersHub, userId: string, ids: readonly string[]): Promise<void> {
  const blocked: string[] = []
  try {
    for (const id of ids) {
      await hub.runner.block(id)
      blocked.push(id)
    }
    for (const id of ids) await hub.files.remove(userId, id)
    await hub.files.removeUser(userId)
  } finally {
    for (const id of blocked) hub.runner.unblock(id)
  }
}
