// `copperflow hub check-data`: checks the ownership and modes the hub relies on in its data directory (after a restore,
// or after anyone changed it by hand), and with --fix repairs what the running user may. It never follows a link, never
// opens a file and never removes anything: a link that points out of its project is reported for a person to look at.
import { chmod, chown, lstat, readdir, readlink } from "node:fs/promises"
import type { Stats } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { KEY_FILE } from "./keys.js"

export const PROJECT_MODE = 0o2770

export interface CheckOptions {
  /** The workspace group's gid. */
  group: number
  fix: boolean
  /** Tests give the identity; default the process's own. */
  uid?: number
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
  // The hub's user is the data directory's owner; a non-root user checking someone else's directory is a problem itself.
  const context: Context = { data, hubUid: top.uid, options, myUid, result }
  if (top.uid === 0) result.problems.push(".: owned by root; the hub never runs as root, so it must be owned by the hub's user")
  if (myUid !== 0 && myUid !== top.uid) result.problems.push(`.: owned by uid ${top.uid}, not by the user running this check (uid ${myUid})`)
  await ownerOnly(context, ".", top)
  for (const name of ["hub.db", "hub.db-wal", "hub.db-shm", KEY_FILE]) {
    const info = await lstat(join(data, name)).catch(() => undefined)
    if (!info) {
      if (name === "hub.db" || name === KEY_FILE) result.problems.push(`${name}: missing`)
      continue
    }
    if (!info.isFile()) result.problems.push(`${name}: not a regular file`)
    else await ownerOnly(context, name, info)
  }
  await walkOwnerOnly(context, "uploads")
  await walkOwnerOnly(context, "trash", true)
  await checkProjects(context)
  return result
}

/** Owned by the hub's user and with no group or other access (the data directory, the database, the key). */
async function ownerOnly(context: Context, path: string, info: Stats): Promise<void> {
  if (info.uid !== context.hubUid) context.result.problems.push(`${path}: owned by uid ${info.uid}, not by the hub's user (uid ${context.hubUid})`)
  if ((info.mode & 0o077) !== 0) {
    const wanted = info.isDirectory() ? 0o700 : 0o600
    await repair(context, path, info, `mode ${octal(info.mode)}: group or others have access (must be ${octal(wanted)})`, () => chmod(join(context.data, path), wanted))
  }
}

/** A folder of the hub's own (uploads, the trash): nothing in it world-accessible. Workspace entries in the trash keep their group. */
async function walkOwnerOnly(context: Context, path: string, groupAllowed = false): Promise<void> {
  const info = await lstat(join(context.data, path)).catch(() => undefined)
  if (!info) return
  await noOthers(context, path, info)
  if (!groupAllowed && info.isDirectory() && info.uid !== context.hubUid) context.result.problems.push(`${path}: owned by uid ${info.uid}, not by the hub's user`)
  if (!info.isDirectory()) return
  for (const name of await readdir(join(context.data, path))) await walkOwnerOnly(context, `${path}/${name}`, groupAllowed)
}

async function checkProjects(context: Context): Promise<void> {
  const root = join(context.data, "projects")
  const info = await lstat(root).catch(() => undefined)
  if (!info) return
  if (!info.isDirectory()) return void context.result.problems.push("projects: not a folder")
  await ownerOnly(context, "projects", info)
  for (const user of await readdir(root)) {
    const userPath = `projects/${user}`
    const userInfo = await lstat(join(context.data, userPath))
    if (!userInfo.isDirectory()) {
      context.result.problems.push(`${userPath}: not a folder`)
      continue
    }
    await ownerOnly(context, userPath, userInfo)
    for (const project of await readdir(join(context.data, userPath))) await checkProject(context, `${userPath}/${project}`)
  }
}

/** A project folder: the hub's, in the workspace group, mode 2770; inside, the group may read and write everything. */
async function checkProject(context: Context, path: string): Promise<void> {
  const full = join(context.data, path)
  const info = await lstat(full)
  if (!info.isDirectory()) return void context.result.problems.push(`${path}: not a folder`)
  if (info.uid !== context.hubUid) context.result.problems.push(`${path}: owned by uid ${info.uid}, not by the hub's user`)
  await inGroup(context, path, info)
  if ((info.mode & 0o7777) !== PROJECT_MODE) await repair(context, path, info, `mode ${octal(info.mode)}, not 2770`, () => chmod(full, PROJECT_MODE))
  await walkProject(context, full, path)
}

async function walkProject(context: Context, projectRoot: string, path: string): Promise<void> {
  for (const name of await readdir(join(context.data, path))) {
    const entryPath = `${path}/${name}`
    const full = join(context.data, entryPath)
    const info = await lstat(full)
    if (info.isSymbolicLink()) {
      const target = resolve(dirname(full), await readlink(full))
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) context.result.problems.push(`${entryPath}: a link that points outside its project (not followed, not removed; look at it)`)
      continue
    }
    await inGroup(context, entryPath, info)
    await noOthers(context, entryPath, info)
    const groupBits = info.isDirectory() ? 0o070 : 0o060
    if ((info.mode & groupBits) !== groupBits) {
      const wanted = (info.mode & 0o7777 & ~0o007) | groupBits | (info.isDirectory() ? 0o2000 : 0)
      await repair(context, entryPath, info, `mode ${octal(info.mode)}: the workspace group cannot ${info.isDirectory() ? "open and change" : "read and write"} it`, () => chmod(full, wanted))
    }
    if (info.isDirectory()) await walkProject(context, projectRoot, entryPath)
  }
}

async function inGroup(context: Context, path: string, info: Stats): Promise<void> {
  if (info.gid === context.options.group) return
  const full = join(context.data, path)
  await repair(context, path, info, `group ${info.gid}, not the workspace group ${context.options.group}`, () => chown(full, info.uid, context.options.group))
}

async function noOthers(context: Context, path: string, info: Stats): Promise<void> {
  if ((info.mode & 0o007) === 0 || info.isSymbolicLink()) return
  await repair(context, path, info, `mode ${octal(info.mode)}: others have access`, () => chmod(join(context.data, path), info.mode & 0o7777 & ~0o007))
}

/** Reports a problem; with --fix repairs it when the running user owns the entry (or is root), else lists it for root. */
async function repair(context: Context, path: string, info: Stats, problem: string, fix: () => Promise<void>): Promise<void> {
  const line = `${path}: ${problem}`
  if (!context.options.fix) return void context.result.problems.push(line)
  if (context.myUid !== 0 && info.uid !== context.myUid) {
    context.result.needsRoot.push(line)
    context.result.problems.push(line)
    return
  }
  try {
    await fix()
    context.result.fixed.push(line)
  } catch (error) {
    context.result.problems.push(`${line} (could not fix: ${(error as NodeJS.ErrnoException).code ?? "error"})`)
  }
}

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0")
}
