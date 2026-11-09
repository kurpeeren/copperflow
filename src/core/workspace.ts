import { mkdir, readdir, readFile, realpath, rm, rmdir, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
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
import { livesOnAs, readEntries, recordEntry, removeEntry, type Author, type HistoryEntry } from "./history.js"
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
    const back = livesOnAs(entries, target.id)
    if (back) throw new Error(`${target.id} was undone and redone as ${back}; undo ${back} instead`)
    if (!undoable(target)) throw new Error(`${target.id} is already undone or is itself an undo`)
    if (options.author === "ai" && target.author !== "ai") throw new Error("The agent can only undo its own changes")

    const loaded = await loadCircuit(root, target.file)
    if (loaded.source !== target.after) {
      throw new Error(`${target.file} has changed since ${target.id}; undo it by hand or with git`)
    }
    if (target.absent === "before") return removeCreated(root, loaded, target, options.author)
    const touched = changedLockedParts(loaded, analyzeCircuit(target.before))
    if (touched.length > 0) throw new Error(`Undoing ${target.id} would change the locked part ${touched.join(", ")}; unlock it first`)

    return writeWithHistory(root, loaded, target.before, {
      author: options.author,
      file: loaded.file,
      // An undo of a redo reads as an undo of the change itself.
      summary: `Undo: ${target.redoOf ? target.summary.replace(/^Redo: /, "") : target.summary}`,
      before: target.after,
      after: target.before,
      undoOf: target.id,
    })
  })
}

/**
 * Redoes one undone change: the newest undo that can still be redone, or the one named (by the undone change's id
 * or by the undo's own). An undo can be redone once, and only until a new change (not an undo or a redo) is made to
 * its file, as in any editor. The agent (`ai`) may only redo its own undos. Refuses when the file changed since the
 * undo, or when the redo would change a part that is locked now. The redo is an ordinary change, so it can be undone.
 */
export function redoChange(root: string, options: { author: Author; id?: string }): Promise<HistoryEntry> {
  return serialized(projectQueues, resolve(root), async () => {
    const undo = redoTarget(await readEntries(root), options)
    if (undo.absent === "after") return recreate(root, undo, options.author)
    const loaded = await loadCircuit(root, undo.file)
    if (loaded.source !== undo.after) {
      throw new Error(`${undo.file} has changed since ${undo.id}; redo it by hand or with git`)
    }
    const touched = changedLockedParts(loaded, analyzeCircuit(undo.before))
    if (touched.length > 0) throw new Error(`Redoing ${undo.undoOf} would change the locked part ${touched.join(", ")}; unlock it first`)

    return writeWithHistory(root, loaded, undo.before, {
      author: options.author,
      file: loaded.file,
      summary: `Redo: ${undo.summary.replace(/^Undo: /, "")}`,
      before: undo.after,
      after: undo.before,
      redoOf: undo.id,
    })
  })
}

/** Undoes a created file: it goes away, unless a part in it is locked now. */
async function removeCreated(root: string, loaded: LoadedCircuit, target: HistoryEntry, author: Author): Promise<HistoryEntry> {
  const locked = loaded.annotations.locks[0]
  if (locked) throw new Error(`Undoing ${target.id} would remove the locked part ${locked.part}; unlock it first`)
  const entry = await recordEntry(root, {
    author,
    file: loaded.file,
    summary: `Undo: ${target.redoOf ? target.summary.replace(/^Redo: /, "") : target.summary}`,
    before: target.after,
    after: "",
    absent: "after",
    undoOf: target.id,
  })
  try {
    await rm(loaded.path)
  } catch (error) {
    await removeEntry(root, entry.id)
    throw error
  }
  return entry
}

/** Redoes the undo of a created file: the file comes back with the text it had. */
async function recreate(root: string, undo: HistoryEntry, author: Author): Promise<HistoryEntry> {
  const path = resolveInRoot(root, undo.file)
  if (await readIfThere(path) !== undefined) throw new Error(`${undo.file} exists again since ${undo.id}; redo it by hand or with git`)
  return writeNew(root, path, undo.before, {
    author,
    summary: `Redo: ${undo.summary.replace(/^Undo: /, "")}`,
    redoOf: undo.id,
  })
}

/** The undo a redo takes back: the named one, else the newest one that can be redone (and, for the agent, is its own). */
function redoTarget(entries: readonly HistoryEntry[], options: { author: Author; id?: string }): HistoryEntry {
  const redoable = redoableUndos(entries)
  const own = (e: HistoryEntry) => options.author === "human" || e.author === "ai"
  if (!options.id) {
    const newest = redoable.find(own)
    if (!newest) throw new Error("Nothing to redo")
    return newest
  }
  const named = entries.find((e) => e.id === options.id)
  if (!named) throw new Error(`No change with id ${options.id}`)
  const undo = named.undoOf ? named : entries.find((e) => e.undoOf === named.id)
  if (!undo) throw new Error(`${named.id} is not undone, so there is nothing to redo`)
  if (!redoable.includes(undo)) {
    const redone = entries.some((e) => e.redoOf === undo.id)
    throw new Error(redone ? `${undo.id} is already redone` : `A newer change to ${undo.file} came after ${undo.id}, so it cannot be redone`)
  }
  if (!own(undo)) throw new Error("The agent can only redo its own undos")
  return undo
}

/** The undos that can be redone, newest first: not redone yet, and no new change to their file after them. */
function redoableUndos(entries: readonly HistoryEntry[]): HistoryEntry[] {
  const redone = new Set(entries.flatMap((e) => (e.redoOf ? [e.redoOf] : [])))
  const changedAfter = new Set<string>()
  const found: HistoryEntry[] = []
  for (const entry of [...entries].reverse()) {
    if (!entry.undoOf && !entry.redoOf) changedAfter.add(entry.file)
    else if (entry.undoOf && !redone.has(entry.id) && !changedAfter.has(entry.file)) found.push(entry)
  }
  return found
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/** Records a history entry for a file that did not exist, then writes it; drops the entry if the write fails. */
async function writeNew(
  root: string,
  path: string,
  text: string,
  meta: { author: Author; summary: string; redoOf?: string },
): Promise<HistoryEntry> {
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

/** The project-relative path with `/` that a circuit file name means, whatever way it was written; refuses a path outside the project. */
export function projectPath(root: string, file: string): string {
  return relative(resolve(root), resolveInRoot(root, file)).split(sep).join("/")
}

/**
 * Writes a circuit file that does not exist yet, as one history entry; the undo removes it again.
 * An existing file is refused unless `replace` is set; replacing is an ordinary change (the undo restores the old
 * text) and is refused while the file has locks.
 */
export function createCircuitFile(
  root: string,
  file: string,
  text: string,
  meta: { author: Author; summary: string; replace?: boolean },
): Promise<HistoryEntry> {
  return serialized(projectQueues, resolve(root), async () => {
    const path = resolveInRoot(root, file)
    if (!CIRCUIT_FILE.test(basename(path))) throw new Error(`${file} must end in .circuit.tsx`)
    const source = await readIfThere(path)
    if (source === undefined) return writeNew(root, path, text, meta)
    if (!meta.replace) throw new Error(`${file} already exists; pass replace: true to overwrite it, or choose another file name`)
    const existing = await resolveCircuit(root, file)
    const locks = (await readAnnotations(annotationsPathFor(existing.path))).locks
    if (locks[0]) throw new Error(`${file} has a locked part (${locks[0].part}); it cannot be replaced`)
    if (source === text) throw new EditError("invalid", "The file already has this content")
    return writeWithHistory(root, { ...existing, source }, text, { author: meta.author, summary: meta.summary, file: existing.file, before: source, after: text })
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
  loaded: Pick<LoadedCircuit, "path" | "source" | "file">,
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
