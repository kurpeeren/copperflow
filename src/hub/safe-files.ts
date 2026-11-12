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
import { lstat, open, readdir, realpath, rmdir, unlink, type FileHandle } from "node:fs/promises"
import { join, relative, sep } from "node:path"
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

/** The regular files under `dir`, found with lstat only; everything else is skipped and noted, never followed. */
export async function walkProject(dir: string, note: SkipNote = () => undefined): Promise<SafeFile[]> {
  const found: SafeFile[] = []
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
    let names: string[]
    try {
      names = await readdir(folder)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
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

/** Bytes the regular files under `dir` take (each counted at its full size, however many links it has). */
export async function usageOf(dir: string): Promise<number> {
  return (await walkProject(dir)).reduce((sum, file) => sum + file.size, 0)
}

async function insideRoot(root: string, path: string): Promise<boolean> {
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path).catch(() => "")])
  const rel = relative(realRoot, realPath)
  return realPath !== "" && rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel)
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

/** Removes `dir` and everything under it without ever following a link: links are unlinked, not their targets. */
export async function removeTree(dir: string): Promise<void> {
  const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return
  if (!info.isDirectory()) return unlink(dir)
  for (const name of await readdir(dir)) await removeTree(join(dir, name))
  await rmdir(dir)
}

/** Throws when any folder between `root` and `path` (both included, `path` only if it exists) is not a real folder. */
export async function checkNoLinks(root: string, path: string): Promise<void> {
  const rel = relative(root, path)
  if (rel.startsWith("..") || /^[A-Za-z]:/.test(rel)) throw new Error("The path is outside the project")
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
