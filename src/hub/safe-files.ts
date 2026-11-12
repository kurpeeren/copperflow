// Every hub-side read or removal of a project folder goes through here. A project folder is bind-mounted read-write
// into its workspace container, so code there can plant symbolic links, or swap a file for a link between the hub's
// look and its read, to make the HUB read or delete host files. The hub therefore never follows a link inside a project:
// it walks with lstat, skips (with a note) every symbolic link, device, socket and FIFO, never descends through a linked
// directory, opens with O_NOFOLLOW, and checks the open handle is the same regular file (device and inode) it listed.
//
// Hard links to files outside the project cannot be made from inside a container, since nothing else is mounted there
// (a hard link needs both names on one mounted filesystem). A file with more than one link is still counted at its full
// size, so usage can never be lowered that way.
//
// The production target is Linux. On Windows there is no O_NOFOLLOW: there the path's realpath is checked to stay inside
// the project before and after opening, which narrows the window but does not close it.
import { constants, type Stats } from "node:fs"
import { chmod, chown, lstat, open, opendir, readdir, realpath, rmdir, unlink, type FileHandle } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"
import type { Readable } from "node:stream"

export interface SafeFile {
  /** Relative path, "/" between folders. */
  name: string
  path: string
  size: number
  modified: Date
  dev: number
  ino: number
}

export type SkipNote = (relativePath: string, why: string) => void

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

function kindOf(info: Stats): string {
  if (info.isSymbolicLink()) return "a symbolic link"
  if (info.isSocket()) return "a socket"
  if (info.isFIFO()) return "a FIFO"
  if (info.isBlockDevice() || info.isCharacterDevice()) return "a device"
  return "not a regular file"
}

/** The most entries a listing (a download) holds in memory. */
export const MAX_LISTED_ENTRIES = 20_000

export class TooManyEntriesError extends Error {
  constructor(max: number) {
    super(`The project holds more than ${max} files and folders, more than the plan allows; delete some before downloading it.`)
  }
}

/** `path` relative to `root` stays inside it (a name such as "..x" is inside; "..", "../x" and another drive are not). */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * The regular files under `dir`, found with lstat only; everything else is skipped and noted, never followed. Refuses
 * (TooManyEntriesError) beyond `maxEntries` entries instead of holding millions in memory.
 */
export async function walkProject(dir: string, note: SkipNote = () => undefined, maxEntries = MAX_LISTED_ENTRIES): Promise<SafeFile[]> {
  const found: SafeFile[] = []
  let entries = 0
  const top = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!top) return found
  if (!top.isDirectory()) {
    note(".", `the folder itself is ${kindOf(top)}; nothing in it is read`)
    return found
  }
  const walk = async (folder: string): Promise<void> => {
    // Read one entry at a time, the cap checked on each, so a folder of millions is refused before it is held.
    const names: string[] = []
    try {
      for await (const entry of await opendir(folder)) {
        entries += 1
        if (entries > maxEntries) throw new TooManyEntriesError(maxEntries)
        names.push(entry.name)
      }
    } catch (error) {
      if (error instanceof TooManyEntriesError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") return
      if (code === "EACCES" || code === "EPERM") {
        note(relative(dir, folder).split(sep).join("/") || ".", "a folder that could not be read (permission denied)")
        return
      }
      throw error
    }
    for (const name of names.sort()) {
      const path = join(folder, name)
      const info = await lstat(path).catch(() => undefined)
      if (!info) continue
      const rel = relative(dir, path).split(sep).join("/")
      if (info.isDirectory()) await walk(path)
      else if (info.isFile()) found.push({ name: rel, path, size: info.size, modified: info.mtime, dev: info.dev, ino: info.ino })
      else note(rel, `${kindOf(info)}; skipped`)
    }
  }
  await walk(dir)
  return found
}

/** A measurement: the bytes, or why there is none (a failure counts as over quota). */
export type Measured = { bytes: number } | { failed: string }

export const MEASURE_MAX_ENTRIES = 100_000
export const MEASURE_MAX_MS = 10_000

const MOVED: Measured = { failed: "a folder moved outside the project while it was measured" }

/**
 * The bytes of the regular files under `root`, each at its full size however many links it has, measured with lstat
 * only: no file is ever opened, so this is safe while a workspace runs. Each folder is read with opendir, one entry at
 * a time, the entry count and the time checked on every entry. Before reading a folder and again after all its
 * entries were looked at, its realpath must still be inside the root and its device and inode unchanged; on any change
 * the whole measurement is discarded (sizes seen through a swapped parent are never reported). Entries count toward
 * the cap, so a tree of millions of empty files is over quota too.
 */
export async function measureTree(root: string, limits: { maxEntries?: number; maxMs?: number; now?: () => number } = {}): Promise<Measured> {
  const maxEntries = limits.maxEntries ?? MEASURE_MAX_ENTRIES
  const maxMs = limits.maxMs ?? MEASURE_MAX_MS
  const now = limits.now ?? Date.now
  const started = now()
  const top = await lstat(root).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)))
  if (!top) return { bytes: 0 }
  if (!top.isDirectory()) return { failed: "the folder is not a folder" }
  const realRoot = await realpath(root)
  /** The folder's identity if it is still a real folder inside the root, else undefined. */
  const identity = async (folder: string): Promise<string | undefined> => {
    const [real, info] = await Promise.all([realpath(folder).catch(() => ""), lstat(folder).catch(() => undefined)])
    if (real === "" || !info?.isDirectory() || !isInside(realRoot, real)) return undefined
    return `${info.dev}:${info.ino}:${real}`
  }
  let bytes = 0
  let entries = 0
  const pending = [root]
  while (pending.length > 0) {
    const folder = pending.pop() as string
    const before = await identity(folder)
    if (before === undefined) return MOVED
    let dir
    try {
      dir = await opendir(folder)
    } catch (error) {
      return { failed: `a folder could not be read (${(error as NodeJS.ErrnoException).code ?? "error"})` }
    }
    let folderBytes = 0
    const folders: string[] = []
    try {
      for await (const entry of dir) {
        entries += 1
        if (entries > maxEntries) return { failed: `more than ${maxEntries} entries` }
        if (now() - started > maxMs) return { failed: `measuring took more than ${maxMs} ms` }
        const info = await lstat(join(folder, entry.name)).catch(() => undefined)
        if (!info) continue
        if (info.isDirectory()) folders.push(join(folder, entry.name))
        else if (info.isFile()) folderBytes += info.size
      }
    } catch (error) {
      return { failed: `a folder could not be read (${(error as NodeJS.ErrnoException).code ?? "error"})` }
    }
    // Only now, with the folder unchanged after its entries were looked at, do its sizes and sub-folders count.
    if ((await identity(folder)) !== before) return MOVED
    bytes += folderBytes
    pending.push(...folders)
  }
  return { bytes }
}

/** Bytes the regular files under `dir` take, lstat only; a failed measurement throws. */
export async function usageOf(dir: string): Promise<number> {
  const measured = await measureTree(dir)
  if ("failed" in measured) throw new Error(`The project folder could not be measured: ${measured.failed}`)
  return measured.bytes
}

async function insideRoot(root: string, path: string): Promise<boolean> {
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path).catch(() => "")])
  return realPath !== "" && relative(realRoot, realPath) !== "" && isInside(realRoot, realPath)
}

/**
 * Opens a listed file for reading without following a link, and checks the handle is that same regular file. Throws
 * when the file was swapped (for a link, or anything else) since it was listed.
 */
export async function openListed(root: string, file: SafeFile): Promise<FileHandle> {
  if (NO_FOLLOW === 0 && !(await insideRoot(root, file.path))) throw new Error(`${file.name} leads outside the project`)
  const handle = await open(file.path, constants.O_RDONLY | NO_FOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.dev !== file.dev || info.ino !== file.ino) throw new Error(`${file.name} changed while it was being read`)
    if (NO_FOLLOW === 0 && !(await insideRoot(root, file.path))) throw new Error(`${file.name} leads outside the project`)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** A stream of a listed file, read from the checked handle (closed when the stream ends). */
export async function readListed(root: string, file: SafeFile): Promise<Readable> {
  const handle = await openListed(root, file)
  return handle.createReadStream({ autoClose: true })
}

/**
 * Removes `dir` and everything under it without ever following a link: links are unlinked, not their targets. Only
 * ever run on a folder no container can write (a staging folder, or a project moved into the trash after its
 * workspace was blocked and confirmed gone): the lstat-then-readdir pair is not atomic.
 */
export async function removeTree(dir: string): Promise<void> { // removal: primitive; its callers are checked
  const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return
  if (!info.isDirectory()) return unlink(dir) // removal: primitive; its callers are checked
  for (const name of await readdir(dir)) await removeTree(join(dir, name)) // removal: primitive; its callers are checked
  await rmdir(dir) // removal: primitive; its callers are checked
}

/**
 * Gives a project folder (itself only, never recursively, never through a link) the workspace group and mode 2770:
 * owned by the hub, writable by the group the hub shares with its workspaces, setgid so what the container creates
 * keeps that group. Does nothing on Windows, which has no such modes.
 */
export async function shareWithWorkspaceGroup(dir: string, gid: number): Promise<void> {
  if (process.platform === "win32" || !process.getuid) return
  const info = await lstat(dir)
  if (!info.isDirectory()) throw new Error("The project folder is not a folder")
  const handle = await open(dir, constants.O_RDONLY | NO_FOLLOW | (constants.O_DIRECTORY ?? 0))
  try {
    const opened = await handle.stat()
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("The project folder changed while it was prepared")
    if (opened.gid !== gid) await handle.chown(process.getuid(), gid)
    if ((opened.mode & 0o7777) !== 0o2770) await handle.chmod(0o2770)
  } finally {
    await handle.close()
  }
}

/**
 * Gives every entry the hub owns under `dir` the workspace group: folders 2770, files 0660; links and special files
 * are left alone, never followed. Run ONLY where no container can act meanwhile: a staging folder no container can
 * see, a project whose workspace is blocked or not yet started, or a folder in the trash. That is what makes the
 * path-based calls after lstat race-free. Entries the workspace owns are its own to keep. Nothing on Windows.
 */
export async function shareTree(dir: string, gid: number): Promise<void> {
  if (process.platform === "win32" || !process.getuid) return
  const uid = process.getuid()
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path).catch(() => undefined)
    if (!info || info.isSymbolicLink()) return
    const ours = info.uid === uid
    if (info.isDirectory()) {
      if (ours) {
        if (info.gid !== gid) await chown(path, uid, gid)
        if ((info.mode & 0o7777) !== 0o2770) await chmod(path, 0o2770)
      }
      for (const name of await readdir(path).catch(() => [] as string[])) await visit(join(path, name))
    } else if (info.isFile() && ours) {
      if (info.gid !== gid) await chown(path, uid, gid)
      // 0o7777: setuid, setgid and sticky bits never survive on a file.
      if ((info.mode & 0o7777) !== 0o660) await chmod(path, 0o660)
    }
  }
  await visit(dir)
}

/**
 * Removes what the hub can under `dir` (only ever a folder in the trash, which no container can see), never following
 * a link, carrying on past entries it may not remove (the cleaning container removes those). True when `dir` is gone.
 */
export async function removeWhatWeCan(dir: string): Promise<boolean> { // removal: primitive; its callers are checked
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path).catch(() => undefined)
    if (!info) return
    if (info.isDirectory()) {
      for (const name of await readdir(path).catch(() => [] as string[])) await visit(join(path, name))
      await rmdir(path).catch(() => undefined) // removal: primitive; its callers are checked
    } else {
      await unlink(path).catch(() => undefined) // removal: primitive; its callers are checked
    }
  }
  await visit(dir)
  return (await lstat(dir).catch(() => undefined)) === undefined
}

/** Throws when any folder between `root` and `path` (both included, `path` only if it exists) is not a real folder. */
export async function checkNoLinks(root: string, path: string): Promise<void> {
  if (!isInside(root, path)) throw new Error("The path is outside the project")
  const rel = relative(root, path)
  let current = root
  for (const part of ["", ...rel.split(sep).filter((piece) => piece !== "")]) {
    current = part === "" ? root : join(current, part)
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) return
    if (info.isSymbolicLink()) throw new Error("The project holds a symbolic link where a folder was expected")
  }
}
