// copperflow workspace-clean /work: run by the hub's short-lived cleaning container (as the workspace user, with only one
// trash folder mounted and no network) to empty a removed project's folder. Code in a workspace owns what it creates and
// may have made it owner-only, which the hub (another uid) can then neither read nor remove; this runs as that owner.
// It makes every entry owner-writable without following links, then removes everything under the folder.
import { chmod, lstat, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

/** The one folder the command accepts: the mount point of the trash folder inside the cleaning container. */
export const CLEAN_ROOT = "/work"

async function makeWritable(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined)
  // A link is never followed: its target is not ours to touch, and removing the link needs only its folder writable.
  if (!info || info.isSymbolicLink()) return
  if (info.isDirectory()) {
    await chmod(path, 0o700).catch(() => undefined)
    for (const name of await readdir(path).catch(() => [] as string[])) await makeWritable(join(path, name))
  } else if (info.isFile()) {
    await chmod(path, 0o600).catch(() => undefined)
  }
}

/** Empties `root` (it stays, empty, for the hub to remove). */
export async function cleanFolder(root: string): Promise<void> {
  await makeWritable(root)
  for (const name of await readdir(root)) await rm(join(root, name), { recursive: true, force: true })
}

export async function runWorkspaceClean(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || args[0] !== CLEAN_ROOT) throw new Error(`Usage: copperflow workspace-clean ${CLEAN_ROOT}`)
  await cleanFolder(CLEAN_ROOT)
}
