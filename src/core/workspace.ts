import { readdir, readFile, realpath, rm } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"
import { analyzeCircuit } from "./analyze.js"
import {
  annotationsPathFor,
  lockKind,
  lockTarget,
  readAnnotations,
  verifyLocks,
  writeAnnotations,
  type Annotations,
  type Lock,
  type LockViolation,
} from "./annotations.js"
import { drawingKeeper } from "./drawing-identity.js"
import { applyEdits, EditError } from "./edit.js"
import { inProjectQueue, isInside, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import { livesOnAs, readEntries, recordEntry, removeEntry, type Author, type HistoryEntry } from "./history.js"
import { circuitPathFor, isLayoutFile, layoutPathFor } from "./layout-file.js"
import { designFor, lockedPartsAt, lockedStart, type DesignSource } from "./layout-locks.js"
import { lockedPartChanges, lockedRecordChanges } from "./layout-records.js"
import { LIBRARY_OWNED_PROPS, libraryIds, libraryImports, PARTS_DIR } from "./library.js"
import { partsInSelector } from "./selectors.js"
import { RULES_PATH } from "../engine/rules/load.js"
import type { CircuitModel, Edit } from "./types.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".copperflow"])
const CIRCUIT_FILE = /\.circuit\.tsx$/

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
  return inProjectQueue(root, async () => {
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

export interface HistoryOptions {
  author: Author
  id?: string
  /**
   * The circuit's built design, for undoing or redoing a layout file change: a track starting on a locked part's pad
   * counts as locked. Without it such a change is refused while the circuit has locked parts. A function is called with
   * the circuit file only when the circuit has locked parts.
   */
  design?: DesignSource
}

/**
 * Undoes one change: the given id, or the newest change that is not undone yet.
 * The agent (`ai`) may only undo its own changes. Refuses when the file changed since,
 * or when the undo would change a part that is locked now.
 */
export function undoChange(root: string, options: HistoryOptions): Promise<HistoryEntry> {
  return inProjectQueue(root, async () => {
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

    const loaded = await loadTracked(root, target.file, options.design)
    if (loaded.source !== target.after) {
      throw new Error(`${target.file} has changed since ${target.id}; undo it by hand or with git`)
    }
    if (target.absent === "before") return removeCreated(root, loaded, target, options.author)
    const touched = loaded.lockChange(target.before)
    if (touched) throw new Error(`Undoing ${target.id} would change the locked ${touched}; unlock it first`)

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
export function redoChange(root: string, options: HistoryOptions): Promise<HistoryEntry> {
  return inProjectQueue(root, async () => {
    const undo = redoTarget(await readEntries(root), options)
    if (undo.absent === "after") return recreate(root, undo, options.author)
    const loaded = await loadTracked(root, undo.file, options.design)
    if (loaded.source !== undo.after) {
      throw new Error(`${undo.file} has changed since ${undo.id}; redo it by hand or with git`)
    }
    const touched = loaded.lockChange(undo.before)
    if (touched) throw new Error(`Redoing ${undo.undoOf} would change the locked ${touched}; unlock it first`)

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

/** A file the history writes: a circuit file or its layout file, with how its locks see a change. */
interface Tracked {
  path: string
  file: string
  source: string
  /** The locked things that would change if the file became `next`, or undefined. */
  lockChange(next: string): string | undefined
  /** The first locked thing in the file, as "part R1" or "track t0001", or undefined. */
  firstLock(): string | undefined
}

/**
 * The layout file of a circuit, by the layout file's project-relative name: the circuit must exist, and the path
 * and name follow the circuit's real spelling, so a crafted name cannot reach another file.
 */
export async function resolveLayoutFile(
  root: string,
  file: string,
): Promise<{ path: string; file: string; circuit: string; circuitPath: string }> {
  const circuit = await resolveCircuit(root, circuitPathFor(file))
  return { path: layoutPathFor(circuit.path), file: layoutPathFor(circuit.file), circuit: circuit.file, circuitPath: circuit.path }
}

/** A layout file's locks: its locked records, and tracks starting on a locked part's pad. */
async function loadTrackedLayout(root: string, file: string, design: DesignSource | undefined): Promise<Tracked> {
  const { path, file: name, circuit, circuitPath } = await resolveLayoutFile(root, file)
  const source = await readIfThere(path)
  if (source === undefined) throw new Error(`${name} does not exist`)
  const lockedParts = await lockedPartsAt(circuitPath)
  const onPart = lockedStart(lockedParts, await designFor(design, circuit, lockedParts.size > 0))
  const lockChange = (next: string) => {
    const found = [lockedRecordChanges(source, next), lockedPartChanges(source, next, onPart)].filter((text) => text !== undefined)
    return found.length === 0 ? undefined : found.join(", ")
  }
  return { path, file: name, source, lockChange, firstLock: () => lockChange("") }
}

/** The project's rules.yaml, which the Design rules panel writes: it holds no locks. */
async function loadTrackedRules(root: string): Promise<Tracked> {
  const path = resolve(root, RULES_PATH)
  const source = await readIfThere(path)
  if (source === undefined) throw new Error(`${RULES_PATH} does not exist`)
  return { path, file: RULES_PATH, source, lockChange: () => undefined, firstLock: () => undefined }
}

async function loadTracked(root: string, file: string, design?: DesignSource): Promise<Tracked> {
  if (isLayoutFile(file)) return loadTrackedLayout(root, file, design)
  if (file === RULES_PATH) return loadTrackedRules(root)
  const loaded = await loadCircuit(root, file)
  const lock = loaded.annotations.locks[0]
  return { ...loaded, lockChange: (next) => changedLocks(loaded, next), firstLock: () => lock && `${lockKind(lock)} ${lock.part}` }
}

/** Undoes a created file: it goes away, unless a part in it is locked now. */
async function removeCreated(root: string, loaded: Tracked, target: HistoryEntry, author: Author): Promise<HistoryEntry> {
  const locked = loaded.firstLock()
  if (locked) throw new Error(`Undoing ${target.id} would remove the locked ${locked}; unlock it first`)
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
  const path = isLayoutFile(undo.file) ? (await resolveLayoutFile(root, undo.file)).path : resolveInRoot(root, undo.file)
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
  return inProjectQueue(root, async () => {
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
  return inProjectQueue(root, async () => {
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

/**
 * The locked parts and drawings that would change if the file became `nextText`, as "part R1, drawing G1",
 * or undefined when none would. A part changes with its props, presence or traces; a drawing when it is no
 * longer the same element (drawing-identity.ts), so an unnamed twin cannot take its id unnoticed.
 */
function changedLocks(current: LoadedCircuit, nextText: string): string | undefined {
  const next = analyzeCircuit(nextText)
  const kept = drawingKeeper(current.source, nextText)
  const drawingChanged = (id: string) => {
    const before = current.model.drawings.find((d) => d.id === id)
    const after = next.drawings.find((d) => d.id === id)
    return before && after ? !kept(before, after) : before !== after
  }
  const changed = current.annotations.locks.filter((lock: Lock) =>
    lock.drawing ? drawingChanged(lock.part) : partState(current.model, lock.part) !== partState(next, lock.part),
  )
  return changed.length === 0 ? undefined : changed.map((lock) => `${lockKind(lock)} ${lock.part}`).join(", ")
}

/** A locked part's props and traces, to compare. */
function partState(model: CircuitModel, name: string): string {
  return JSON.stringify({
    props: lockTarget(model, name, "part")?.props ?? null,
    traces: model.traces
      .filter((t) => [t.from, t.to].some((end) => end !== undefined && partsInSelector(end).includes(name)))
      .map((t) => [t.from, t.to, t.props])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })
}

export { isInside }
