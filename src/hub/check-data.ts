// `copperflow hub check-data`: checks the ownership and modes the hub relies on in its data directory (after a restore,
// or after anyone changed it by hand). The check alone only looks (lstat and readlink, never following a link, never
// opening a file). With --fix it repairs what the running user owns, and only through a handle opened without
// following links whose device and inode match what was looked at (safe-files.ts): a link planted in a project, or an
// entry swapped for one meanwhile, can never redirect a chmod or chown onto another file. It never removes anything.
import { lstat, readdir, readlink } from "node:fs/promises"
import type { Stats } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { KEY_FILE } from "./keys.js"
import { isInside, repairThroughHandle, walkEntries } from "./safe-files.js"

export const PROJECT_MODE = 0o2770
/** setuid and setgid. */
const SPECIAL_BITS = 0o6000

export interface CheckOptions {
  /** The workspace group's gid. */
  group: number
  fix: boolean
  /** Tests give the identity; default the process's own. */
  uid?: number
  /** Tests swap an entry between the look and the repair. */
  beforeRepair?: (path: string) => Promise<void>
}

export interface CheckResult {
  /** `<path relative to the data directory>: <problem>`, not yet sanitised. */
  problems: string[]
  fixed: string[]
  /** What the running user may not repair (another owner): root must. */
  needsRoot: string[]
}

interface Context {
  data: string
  hubUid: number
  options: CheckOptions
  myUid: number
  result: CheckResult
}

/** Checks the data directory's invariants (docs/hosted.md, "Users and groups"); POSIX only. */
export async function checkDataDir(data: string, options: CheckOptions): Promise<CheckResult> {
  const result: CheckResult = { problems: [], fixed: [], needsRoot: [] }
  const top = await lstat(data)
  const myUid = options.uid ?? process.getuid?.() ?? 0
  const context: Context = { data, hubUid: top.uid, options, myUid, result }
  if (!top.isDirectory()) {
    result.problems.push(".: not a folder")
    return result
  }
  if (top.uid === 0) result.problems.push(".: owned by root; the hub never runs as root, so it must be owned by the hub's user")
  if (myUid !== 0 && myUid !== top.uid) result.problems.push(`.: owned by uid ${top.uid}, not by the user running this check (uid ${myUid})`)
  await ownerOnly(context, data, top)
  for (const name of ["hub.db", "hub.db-wal", "hub.db-shm", KEY_FILE]) {
    const info = await lstat(join(data, name)).catch(() => undefined)
    if (!info) {
      if (name === "hub.db" || name === KEY_FILE) result.problems.push(`${name}: missing`)
      continue
    }
    if (!info.isFile()) result.problems.push(`${name}: not a regular file`)
    else await ownerOnly(context, join(data, name), info)
  }
  for (const folder of ["uploads", "trash"]) await checkOthersBelow(context, join(data, folder))
  await checkProjects(context)
  return result
}

function shown(context: Context, path: string): string {
  return relative(context.data, path).split(sep).join("/") || "."
}

/** Owned by the hub's user and with no group or other access (the data directory, the database, the key). */
async function ownerOnly(context: Context, path: string, info: Stats): Promise<void> {
  if (info.uid !== context.hubUid) context.result.problems.push(`${shown(context, path)}: owned by uid ${info.uid}, not by the hub's user (uid ${context.hubUid})`)
  if ((info.mode & 0o077) !== 0) await repair(context, path, info, `mode ${octal(info.mode)}: group or others have access (must be ${octal(info.isDirectory() ? 0o700 : 0o600)})`, { mode: info.isDirectory() ? 0o700 : 0o600 })
}

/** A folder of the hub's own (uploads, the trash): nothing in it may be open to others. */
async function checkOthersBelow(context: Context, folder: string): Promise<void> {
  const info = await lstat(folder).catch(() => undefined)
  if (!info) return
  if (!info.isDirectory()) return void context.result.problems.push(`${shown(context, folder)}: not a folder`)
  await noOthers(context, folder, info)
  const moved = await walkEntries(folder, async (path, entry) => {
    if (entry.isSymbolicLink() || special(context, path, entry)) return false
    await noOthers(context, path, entry)
    return true
  })
  for (const path of moved) context.result.problems.push(`${shown(context, path)}: a folder that changed while it was read; run the check again`)
}

async function checkProjects(context: Context): Promise<void> {
  const root = join(context.data, "projects")
  const info = await lstat(root).catch(() => undefined)
  if (!info) return
  if (!info.isDirectory()) return void context.result.problems.push("projects: not a folder")
  await ownerOnly(context, root, info)
  for (const user of await readdir(root)) {
    const userPath = join(root, user)
    const userInfo = await lstat(userPath)
    if (!userInfo.isDirectory()) {
      context.result.problems.push(`${shown(context, userPath)}: not a folder`)
      continue
    }
    await ownerOnly(context, userPath, userInfo)
    for (const project of await readdir(userPath)) await checkProject(context, join(userPath, project))
  }
}

/** A project folder: the hub's, in the workspace group, mode 2770; inside, the group may read and write everything. */
async function checkProject(context: Context, project: string): Promise<void> {
  const info = await lstat(project)
  if (!info.isDirectory()) return void context.result.problems.push(`${shown(context, project)}: not a folder`)
  if (info.uid !== context.hubUid) context.result.problems.push(`${shown(context, project)}: owned by uid ${info.uid}, not by the hub's user`)
  await inGroup(context, project, info)
  if ((info.mode & 0o7777) !== PROJECT_MODE) await repair(context, project, info, `mode ${octal(info.mode)}, not 2770`, { mode: PROJECT_MODE })
  const moved = await walkEntries(project, async (path, entry) => {
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path))
      if (!isInside(project, target)) context.result.problems.push(`${shown(context, path)}: a link that points outside its project (not followed, not changed, not removed; look at it)`)
      return false
    }
    if (special(context, path, entry)) return false
    if (entry.isFile() && entry.nlink > 1) {
      context.result.problems.push(`${shown(context, path)}: a file with ${entry.nlink} links (never changed by --fix; look at it)`)
      if ((entry.mode & SPECIAL_BITS) !== 0) context.result.problems.push(`${shown(context, path)}: mode ${octal(entry.mode)}: a setuid or setgid bit on a file with ${entry.nlink} links (never changed by --fix; look at it)`)
      return false
    }
    await inGroup(context, path, entry)
    await noOthers(context, path, entry)
    // A workspace may set these on its own files; nothing on the host should ever run them, so they are reported, and
    // --fix clears them through the checked handle like its other repairs. The final mode also has no other access.
    if (entry.isFile() && (entry.mode & SPECIAL_BITS) !== 0) {
      await repair(context, path, entry, `mode ${octal(entry.mode)}: a setuid or setgid bit (a workspace set it; nothing on the host should run this file)`, { mode: entry.mode & 0o7777 & ~SPECIAL_BITS & ~0o007 })
    }
    const groupBits = entry.isDirectory() ? 0o070 : 0o060
    if ((entry.mode & groupBits) !== groupBits) {
      const wanted = ((entry.mode & 0o7777 & ~0o007) | groupBits | (entry.isDirectory() ? 0o2000 : 0)) & (entry.isFile() ? ~SPECIAL_BITS : 0o7777)
      await repair(context, path, entry, `mode ${octal(entry.mode)}: the workspace group cannot ${entry.isDirectory() ? "open and change" : "read and write"} it`, { mode: wanted })
    }
    return true
  })
  for (const path of moved) context.result.problems.push(`${shown(context, path)}: a folder that changed while it was read; run the check again`)
}

/** Devices, sockets and FIFOs are reported and never changed or followed. */
function special(context: Context, path: string, info: Stats): boolean {
  if (info.isDirectory() || info.isFile() || info.isSymbolicLink()) return false
  context.result.problems.push(`${shown(context, path)}: ${info.isSocket() ? "a socket" : info.isFIFO() ? "a FIFO" : "a device"} (never changed; look at it)`)
  return true
}

async function inGroup(context: Context, path: string, info: Stats): Promise<void> {
  if (info.gid === context.options.group) return
  await repair(context, path, info, `group ${info.gid}, not the workspace group ${context.options.group}`, { gid: context.options.group })
}

async function noOthers(context: Context, path: string, info: Stats): Promise<void> {
  if ((info.mode & 0o007) === 0) return
  await repair(context, path, info, `mode ${octal(info.mode)}: others have access`, { mode: info.mode & 0o7777 & ~0o007 })
}

/**
 * Reports a problem; with --fix repairs it through a checked handle when the running user owns the entry, else lists
 * it for root. An entry that changed between the look and the repair is reported and left alone.
 */
async function repair(context: Context, path: string, info: Stats, problem: string, change: { mode?: number; gid?: number }): Promise<void> {
  const line = `${shown(context, path)}: ${problem}`
  if (!context.options.fix) return void context.result.problems.push(line)
  if (info.uid !== context.myUid) {
    context.result.needsRoot.push(line)
    context.result.problems.push(line)
    return
  }
  await context.options.beforeRepair?.(path)
  try {
    const outcome = await repairThroughHandle(path, info, change)
    if (outcome === "repaired") context.result.fixed.push(line)
    else context.result.problems.push(`${line} (${outcome === "changed" ? "it changed while it was checked; left alone" : "not changed: not a plain file or folder"})`)
  } catch (error) {
    context.result.problems.push(`${line} (could not fix: ${(error as NodeJS.ErrnoException).code ?? "error"})`)
  }
}

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0")
}
