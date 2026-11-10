// The sheet files a change writes besides its circuit file: a new circuit with sub-sheets writes them all as one
// history entry, and its undo and redo take them all back together. Sheet files hold no locks.
import { mkdir, realpath, rm, stat } from "node:fs/promises"
import { basename, dirname, relative, resolve, sep } from "node:path"
import { writeFileAtomic } from "./fs-utils.js"
import { isInside, readIfThere } from "./file-writes.js"
import type { FileChange } from "./history.js"

export const SHEET_FILE = /\.sheet\.tsx$/

/** A sheet file's path on disk, refused unless it is a `.sheet.tsx` file whose nearest existing folder is inside the project. */
async function sheetPath(root: string, file: string): Promise<string> {
  if (file.includes("\0")) throw new Error("A file path cannot contain a NUL character")
  const path = resolve(root, file)
  if (!SHEET_FILE.test(basename(path))) throw new Error(`${file} must end in .sheet.tsx`)
  if (!isInside(resolve(root), path)) throw new Error(`${file} is outside the project root`)
  let folder = dirname(path)
  while (!(await stat(folder).then(() => true, () => false))) folder = dirname(folder)
  const realRoot = await realpath(resolve(root))
  const real = await realpath(folder)
  if (real !== realRoot && !isInside(realRoot, real)) throw new Error(`${file} is outside the project root`)
  return path
}

const projectFile = (root: string, path: string): string => relative(resolve(root), path).split(sep).join("/")

/**
 * The changes writing these sheet files would make, checked before anything is written: an existing file is refused
 * unless `replace` is set, and a file that already has the text is left out.
 */
export async function planSheetWrites(root: string, sheets: readonly { file: string; text: string }[], replace: boolean): Promise<FileChange[]> {
  const changes: FileChange[] = []
  for (const sheet of sheets) {
    const path = await sheetPath(root, sheet.file)
    const file = projectFile(root, path)
    const current = await readIfThere(path)
    if (current === undefined) changes.push({ file, before: "", after: sheet.text, absent: "before" })
    else if (!replace) throw new Error(`${file} already exists; pass replace: true to overwrite it, or choose another sheet name`)
    else if (current !== sheet.text) changes.push({ file, before: current, after: sheet.text })
  }
  return changes
}

const textOn = (change: FileChange, side: "before" | "after"): string | undefined => (change.absent === side ? undefined : change[side])

/** Refuses, naming the file, unless every file is now as it was on `side` of the change (absent there: missing). */
export async function checkSheetFiles(root: string, changes: readonly FileChange[], side: "before" | "after", id: string, verb: "undo" | "redo"): Promise<void> {
  for (const change of changes) {
    const now = await readIfThere(await sheetPath(root, change.file))
    if (now === textOn(change, side)) continue
    const why = now !== undefined && change.absent === side ? "exists again" : "has changed"
    throw new Error(`${change.file} ${why} since ${id}; ${verb} it by hand or with git`)
  }
}

/** Writes every file as it is on `side` of the change: its text, or removed when it is absent there. */
export async function writeSheetFiles(root: string, changes: readonly FileChange[], side: "before" | "after"): Promise<void> {
  for (const change of changes) {
    const path = await sheetPath(root, change.file)
    const text = textOn(change, side)
    if (text === undefined) await rm(path, { force: true })
    else {
      await mkdir(dirname(path), { recursive: true })
      await writeFileAtomic(path, text)
    }
  }
}

/** The same changes the other way round, for the entry that undoes or redoes them. */
export function invertChanges(changes: readonly FileChange[]): FileChange[] {
  return changes.map(({ file, before, after, absent }) => ({ file, before: after, after: before, ...(absent ? { absent: absent === "before" ? "after" : "before" } : {}) }))
}

/** `{ also }` for a history entry, or nothing when there are no other files. */
export const alsoField = (changes: readonly FileChange[]): { also?: FileChange[] } => (changes.length === 0 ? {} : { also: [...changes] })
