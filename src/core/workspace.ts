import { readdir, readFile, realpath } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { analyzeCircuit } from "./analyze.js"
import {
  annotationsPathFor,
  readAnnotations,
  verifyLocks,
  writeAnnotations,
  type Annotations,
  type LockViolation,
} from "./annotations.js"
import { applyEdits, EditError } from "./edit.js"
import { serialized, writeFileAtomic } from "./fs-utils.js"
import { readEntries, recordEntry, removeEntry, type Author, type HistoryEntry } from "./history.js"
import { LIBRARY_OWNED_PROPS, libraryIds, libraryImports, PARTS_DIR } from "./library.js"
import { partsInSelector } from "./selectors.js"
import type { CircuitModel, Edit } from "./types.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".copperflow"])
const CIRCUIT_FILE = /\.circuit\.tsx$/
const projectQueues = new Map<string, Promise<void>>()

export interface LoadedCircuit {
  file: string
  path: string
  source: string
  model: CircuitModel
  annotations: Annotations
  violations: LockViolation[]
}

export interface EditResult {
  entry: HistoryEntry
  model: CircuitModel
  violations: LockViolation[]
}

/** Resolves a project-relative path and rejects anything outside the project root. */
export function resolveInRoot(root: string, file: string): string {
  if (file.includes("\0")) throw new Error("A file path cannot contain a NUL character")
  const path = resolve(root, file)
  if (!isInside(resolve(root), path)) throw new Error(`${file} is outside the project root`)
  return path
}

/**
 * Resolves a circuit file to its real path on disk: symlinks followed, and on
 * case-insensitive file systems the spelling on disk. Locks are looked up from this path,
 * so a differently spelled path cannot skip them.
 */
export async function resolveCircuit(root: string, file: string): Promise<{ path: string; file: string }> {
  resolveInRoot(root, file)
  const realRoot = await realpath(resolve(root))
  let path: string
  try {
    path = await realpath(resolve(root, file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${file} does not exist`)
    throw error
  }
  if (!isInside(realRoot, path)) throw new Error(`${file} is outside the project root`)
  if (!CIRCUIT_FILE.test(basename(path))) throw new Error(`${file} is not a *.circuit.tsx file`)
  return { path, file: relative(realRoot, path).split(sep).join("/") }
}

/** Circuit files (`*.circuit.tsx`) in the project, as sorted project-relative paths. */
export async function listCircuits(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) await visit(join(dir, entry.name))
      else if (entry.isFile() && CIRCUIT_FILE.test(entry.name)) {
        found.push(relative(resolve(root), join(dir, entry.name)).split(sep).join("/"))
      }
    }
  }
  await visit(resolve(root))
  return found.sort()
}

export async function loadCircuit(root: string, file: string): Promise<LoadedCircuit> {
  const resolved = await resolveCircuit(root, file)
  const source = await readFile(resolved.path, "utf8")
  const model = analyzeCircuit(source)
  const annotations = await readAnnotations(annotationsPathFor(resolved.path))
  return { ...resolved, source, model, annotations, violations: verifyLocks(annotations, model) }
}

/** Applies edits to a circuit file, honouring its locks, and records one history entry. */
export function editCircuit(
  root: string,
  file: string,
  edits: Edit[],
  meta: { author: Author; summary: string },
): Promise<EditResult> {
  return serialized(projectQueues, resolve(root), async () => {
    const loaded = await loadCircuit(root, file)
    await refuseLibraryOverrides(root, loaded, edits)
    const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
    const after = applyEdits(loaded.source, edits, locked)
    if (after === loaded.source) throw new EditError("invalid", "The edit made no change")
    const entry = await writeWithHistory(root, loaded, after, { ...meta, file: loaded.file, before: loaded.source, after })
    const model = analyzeCircuit(after)
    return { entry, model, violations: verifyLocks(loaded.annotations, model) }
  })
}

/**
 * Undoes one change: the given id, or the newest change that is not undone yet.
 * The agent (`ai`) may only undo its own changes. Refuses when the file changed since,
 * or when the undo would change a part that is locked now.
 */
export function undoChange(root: string, options: { author: Author; id?: string }): Promise<HistoryEntry> {
  return serialized(projectQueues, resolve(root), async () => {
    const entries = await readEntries(root)
    const undone = new Set(entries.flatMap((e) => (e.undoOf ? [e.undoOf] : [])))
    const undoable = (e: HistoryEntry) => !e.undoOf && !undone.has(e.id)
    const target = options.id
      ? entries.find((e) => e.id === options.id)
      : entries.filter((e) => undoable(e) && (options.author === "human" || e.author === "ai")).pop()
    if (!target) throw new Error(options.id ? `No change with id ${options.id}` : "Nothing to undo")
    if (!undoable(target)) throw new Error(`${target.id} is already undone or is itself an undo`)
    if (options.author === "ai" && target.author !== "ai") throw new Error("The agent can only undo its own changes")

    const loaded = await loadCircuit(root, target.file)
    if (loaded.source !== target.after) {
      throw new Error(`${target.file} has changed since ${target.id}; undo it by hand or with git`)
    }
    const touched = changedLockedParts(loaded, analyzeCircuit(target.before))
    if (touched.length > 0) throw new Error(`Undoing ${target.id} would change the locked part ${touched.join(", ")}; unlock it first`)

    return writeWithHistory(root, loaded, target.before, {
      author: options.author,
      file: loaded.file,
      summary: `Undo: ${target.summary}`,
      before: target.after,
      after: target.before,
      undoOf: target.id,
    })
  })
}

/** Reads a circuit's annotations, applies `change` and writes the result. */
export function updateAnnotations(
  root: string,
  file: string,
  change: (annotations: Annotations) => Annotations,
): Promise<Annotations> {
  return serialized(projectQueues, resolve(root), async () => {
    const path = annotationsPathFor((await resolveCircuit(root, file)).path)
    const next = change(await readAnnotations(path))
    await writeAnnotations(path, next)
    return next
  })
}

/** Library parts own their footprint, part numbers and pins; an instance cannot override them. */
async function refuseLibraryOverrides(root: string, loaded: LoadedCircuit, edits: Edit[]): Promise<void> {
  const library = libraryImports(loaded.model, loaded.file, await libraryIds(root))
  for (const edit of edits) {
    if (edit.kind !== "setProps" && edit.kind !== "addPart") continue
    const tag = edit.kind === "addPart" ? edit.tag : loaded.model.parts.find((p) => p.name === edit.part)?.tag
    const id = tag === undefined ? undefined : library.get(tag)
    const owned = Object.keys(edit.props ?? {}).find((key) => LIBRARY_OWNED_PROPS.includes(key))
    if (id && owned) throw new EditError("invalid", `${owned} comes from ${PARTS_DIR}/${id}/part.yaml; change it there`)
  }
}

/** Records the history entry first, then writes the file; drops the entry if the write fails. */
async function writeWithHistory(
  root: string,
  loaded: LoadedCircuit,
  text: string,
  data: Omit<HistoryEntry, "id" | "time">,
): Promise<HistoryEntry> {
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

/** Locked parts whose props, presence or traces differ between the current file and `next`. */
function changedLockedParts(current: LoadedCircuit, next: CircuitModel): string[] {
  const state = (model: CircuitModel, name: string) =>
    JSON.stringify({
      props: model.parts.find((p) => p.name === name)?.props ?? null,
      traces: model.traces
        .filter((t) => [t.from, t.to].some((end) => end !== undefined && partsInSelector(end).includes(name)))
        .map((t) => [t.from, t.to, t.props])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })
  return current.annotations.locks
    .map((lock) => lock.part)
    .filter((name) => state(current.model, name) !== state(next, name))
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
