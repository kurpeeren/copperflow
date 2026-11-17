// The project's files as they were around one change, or since one: rebuilt from the files on disk now and the history,
// which keeps the full text of each file before and after every change.
import { ENGINE_FILES } from "../engine/engine.js"
import { collectProjectFiles, isProjectFile } from "../engine/project-files.js"
import { EditError } from "./edit-error.js"
import { readEntries, type HistoryEntry } from "./history.js"

/** One change, or everything after one. */
export type ChangeTarget = { id: string } | { since: string }

/** The project's build files at one point, and the files whose text there could not be told for sure. */
export interface ProjectAt {
  files: Record<string, string>
  /** Somebody edited the file by hand between two changes that wrote it, so its text here may be off. */
  unsure: string[]
}

export interface ChangeFiles {
  /** The changes covered: the one change, or every change after `since`, oldest first. */
  entries: HistoryEntry[]
  before: ProjectAt
  after: ProjectAt
  /** The files whose text differs between before and after, in path order. */
  changed: string[]
}

/** One write of a file by a change: the text before and after, undefined where the file did not exist. */
interface Write {
  index: number
  before: string | undefined
  after: string | undefined
}

/** Every file each change wrote: its main file and the others it wrote with it. */
function writesOf(entries: readonly HistoryEntry[]): Map<string, Write[]> {
  const writes = new Map<string, Write[]>()
  const add = (file: string, write: Write) => writes.set(file, [...(writes.get(file) ?? []), write])
  for (const [index, entry] of entries.entries()) {
    for (const change of [entry, ...(entry.also ?? [])]) {
      add(change.file, {
        index,
        before: change.absent === "before" ? undefined : change.before,
        after: change.absent === "after" ? undefined : change.after,
      })
    }
  }
  return writes
}

/**
 * The project after the first `count` entries: each file's text after the newest of those that wrote it; for a file
 * only later entries wrote, the text before the first of them; else the text on disk. A file is unsure when the text
 * that came next (the next write's before, or the disk) is not what that newest write left.
 */
export function projectAt(entries: readonly HistoryEntry[], disk: Readonly<Record<string, string>>, count: number): ProjectAt {
  const writes = writesOf(entries)
  const files: Record<string, string> = {}
  const unsure: string[] = []
  for (const file of [...new Set([...Object.keys(disk), ...writes.keys()])].sort()) {
    const list = writes.get(file) ?? []
    const last = list.filter((write) => write.index < count).at(-1)
    const text = last ? last.after : list.length > 0 ? list[0]?.before : disk[file]
    if (text !== undefined) files[file] = text
    if (!last) continue
    const following = list.find((write) => write.index > last.index)
    if ((following ? following.before : disk[file]) !== last.after) unsure.push(file)
  }
  return { files, unsure }
}

const sameText = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => (file: string) => a[file] === b[file]

/** The files around a change (`id`), or after a change against the disk now (`since`). Refuses an id the history does not have. */
export async function changeFiles(root: string, target: ChangeTarget): Promise<ChangeFiles> {
  const id = "id" in target ? target.id : target.since
  const all = await readEntries(root)
  const index = all.findIndex((entry) => entry.id === id)
  if (index < 0) throw new EditError("not_found", `No change ${id} in the history`)
  const built = (file: string) => isProjectFile(file, ENGINE_FILES)
  const entries = all.map((entry) => ({ ...entry, also: entry.also?.filter((change) => built(change.file)) })).filter((entry) => built(entry.file))
  const disk = await collectProjectFiles(root, { include: ENGINE_FILES })
  const count = entries.findIndex((entry) => entry.id === id)
  const position = count < 0 ? entries.filter((entry) => Number(entry.id.slice(1)) < Number(id.slice(1))).length : count
  const before = "id" in target ? projectAt(entries, disk, position) : projectAt(entries, disk, position + 1)
  const after = "id" in target ? projectAt(entries, disk, position + 1) : { files: { ...disk }, unsure: [] }
  const files = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()
  const changed = files.filter((file) => !sameText(before.files, after.files)(file))
  const covered = "id" in target ? [all[index] as HistoryEntry] : all.slice(index + 1)
  return { entries: covered, before, after, changed }
}
