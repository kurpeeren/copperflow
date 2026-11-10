import { mkdir, readFile, realpath, rmdir, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { serialized, writeFileAtomic } from "./fs-utils.js"
import { assertEntryData, recordEntry, removeEntry, type Author, type FileChange, type HistoryEntry } from "./history.js"

/** One queue per project root: every change to a project's files runs after the one before. */
const projectQueues = new Map<string, Promise<void>>()

/** Runs a change to the project at `root` after the changes queued before it. */
export function inProjectQueue<T>(root: string, task: () => Promise<T>): Promise<T> {
  return serialized(projectQueues, resolve(root), task)
}

export async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    // A path under a plain file (ENOTDIR) is not there either.
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined
    throw error
  }
}

/** Records a history entry for a file that did not exist, then writes it; drops the entry if the write fails. */
export async function writeNew(
  root: string,
  path: string,
  text: string,
  meta: { author: Author; summary: string; redoOf?: string; also?: FileChange[] },
): Promise<HistoryEntry> {
  assertEntryData({ ...meta, file: "x", before: "", after: text, absent: "before" })
  const place = await newFilePlace(root, path)
  await mkdir(dirname(path), { recursive: true })
  let entry: HistoryEntry | undefined
  try {
    entry = await recordEntry(root, { ...meta, file: place.file, before: "", after: text, absent: "before" })
    await writeFileAtomic(path, text)
    return entry
  } catch (error) {
    if (entry) await removeEntry(root, entry.id)
    for (const folder of place.created) await rmdir(folder).catch(() => undefined)
    throw error
  }
}

/**
 * Where a file that does not exist yet would land, found before anything is created: the project-relative name in the
 * spelling later edits record (the real folder plus the file name), and the folders that are missing, deepest first.
 * Refuses a place whose nearest existing folder is outside the project, symlinks followed.
 */
async function newFilePlace(root: string, path: string): Promise<{ file: string; created: string[] }> {
  const missing: string[] = []
  let folder = dirname(path)
  while (!(await stat(folder).then(() => true, () => false))) {
    missing.push(folder)
    folder = dirname(folder)
  }
  const realRoot = await realpath(resolve(root))
  const realFolder = await realpath(folder)
  if (realFolder !== realRoot && !isInside(realRoot, realFolder)) throw new Error(`${relative(resolve(root), path).split(sep).join("/")} is outside the project root`)
  const below = [...missing].reverse().map((dir) => basename(dir))
  const file = relative(realRoot, join(realFolder, ...below, basename(path))).split(sep).join("/")
  return { file, created: missing }
}

/** Records the history entry first, then writes the file; drops the entry if the write fails. */
export async function writeWithHistory(
  root: string,
  loaded: { path: string; source: string; file: string },
  text: string,
  data: Omit<HistoryEntry, "id" | "time">,
): Promise<HistoryEntry> {
  assertEntryData(data)
  if ((await readFile(loaded.path, "utf8")) !== loaded.source) {
    throw new Error(`${loaded.file} changed while it was being edited; try again`)
  }
  const entry = await recordEntry(root, data)
  try {
    await writeFileAtomic(loaded.path, text)
  } catch (error) {
    await removeEntry(root, entry.id)
    throw error
  }
  return entry
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
