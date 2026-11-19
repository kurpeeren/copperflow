// The project folder as the Studio's Files tab shows it: a flat list in tree order, which folders it leaves out, and the
// limits that keep a huge folder from stalling the server. Links (symlinks, Windows junctions) are listed, never entered,
// so the list cannot lead out of the project.
import type { Dirent } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import { projectRoot } from "./studio-note.js"

/** The most entries one listing answers. */
export const MAX_FILE_ENTRIES = 5000
/** How many folder levels a listing goes down: an entry's path has at most this many parts. */
export const MAX_FILE_DEPTH = 8
/** The one dot-folder the list shows: the project's history. */
const SHOWN_DOT_FOLDER = ".copperflow"
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"])

export type FileKind = "dir" | "file" | "link"

export interface FileEntry {
  /** Relative to the project root, with "/" between folders. */
  path: string
  kind: FileKind
  size: number
  /** ISO time of the last change. */
  modified: string
}

export interface FileListing {
  /** The project root's real absolute path, for Copy path and Show in folder. */
  root: string
  entries: FileEntry[]
  /** True when the entry or depth limit left something out. */
  truncated: boolean
}

/** A folder the list leaves out: node_modules, .git and every dot-folder but .copperflow. */
export function isSkippedFolder(name: string): boolean {
  return SKIPPED_FOLDERS.has(name) || (name.startsWith(".") && name !== SHOWN_DOT_FOLDER)
}

/**
 * A changed path the Files tab does not show: one inside a skipped folder, or node_modules and .git themselves. The last
 * part may be a file, so a dot-file such as .gitignore still counts as shown.
 */
export function isSkippedPath(path: string): boolean {
  const parts = path.split("/")
  const last = parts.pop() ?? ""
  return SKIPPED_FOLDERS.has(last) || parts.some(isSkippedFolder)
}

/** Folders first, then by name without regard to case (the exact name breaks a tie, so the order is stable). */
function byKindThenName(a: Dirent, b: Dirent): number {
  const folder = Number(b.isDirectory()) - Number(a.isDirectory())
  if (folder !== 0) return folder
  const name = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return name !== 0 ? name : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

interface Walk {
  entries: FileEntry[]
  truncated: boolean
  maxEntries: number
}

/** The folder's entries, or none when it went away since its parent was read (the agent may delete while we list). */
async function readFolder(path: string): Promise<Dirent[] | undefined> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    // A folder deleted between the two reads is simply no longer in the project; any other failure is the caller's.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function entryOf(path: string, relative: string, item: Dirent): Promise<FileEntry | undefined> {
  // lstat, not stat: a link's own size and time, without following it.
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    // Deleted since the folder was read: left out, as above.
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (info === undefined) return undefined
  const kind: FileKind = item.isSymbolicLink() || info.isSymbolicLink() ? "link" : item.isDirectory() ? "dir" : "file"
  return { path: relative, kind, size: kind === "dir" ? 0 : info.size, modified: info.mtime.toISOString() }
}

async function walk(state: Walk, folder: string, prefix: string, depth: number): Promise<void> {
  const items = await readFolder(folder)
  if (items === undefined) return
  for (const item of items.filter((one) => !(one.isDirectory() && isSkippedFolder(one.name))).sort(byKindThenName)) {
    if (state.entries.length >= state.maxEntries) {
      state.truncated = true
      return
    }
    const path = join(folder, item.name)
    const entry = await entryOf(path, prefix + item.name, item)
    if (entry === undefined) continue
    state.entries.push(entry)
    if (entry.kind !== "dir") continue
    if (depth < MAX_FILE_DEPTH) await walk(state, path, `${entry.path}/`, depth + 1)
    else if (((await readFolder(path)) ?? []).length > 0) state.truncated = true
  }
}

/** The project folder as a flat list in tree order (each folder followed by what it holds). */
export async function listProjectFiles(root: string, options: { maxEntries?: number } = {}): Promise<FileListing> {
  const real = projectRoot(root)
  const state: Walk = { entries: [], truncated: false, maxEntries: options.maxEntries ?? MAX_FILE_ENTRIES }
  await walk(state, real, "", 1)
  return { root: real, entries: state.entries, truncated: state.truncated }
}
