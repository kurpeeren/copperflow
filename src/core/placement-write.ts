// The placer's positions written as code: each placed part's pcbX, pcbY and pcbRotation, as the part's own props mean
// them (less what its groups add; inside a sub-sheet instance, turned back into the sheet's frame and written into the
// sheet file, which every instance of it shares), as ONE history entry with the sheet files as its `also`, so undo
// takes the whole run back. Optionally the board is fitted round the parts in the same entry.
import { readFile } from "node:fs/promises"
import { buildDesign, type Design } from "../engine/design.js"
import { ENGINE_FILES } from "../engine/engine.js"
import { frameTurn } from "../engine/instance-anchor.js"
import type { Component } from "../engine/model.js"
import { naturalCompare } from "../engine/order.js"
import { fitBoard, type BlockMove, type FitBoard, type PlacedPosition } from "../engine/pcb-place/index.js"
import { collectProjectFiles } from "../engine/project-files.js"
import { applyEdits } from "./edit.js"
import { inProjectQueue, writeWithHistory } from "./file-writes.js"
import { assertMeta, type Author, type FileChange, type HistoryEntry } from "./history.js"
import { alsoField, sheetFilesFirst } from "./sheet-files.js"
import type { CircuitModel, Edit, PropInfo } from "./types.js"
import { loadCircuit, resolveCircuit } from "./workspace.js"

/** The edits that write a placement: the circuit's own parts, and the parts each sheet file holds. */
export interface PlacementWrites {
  circuit: Edit[]
  /** Each sheet file's edits, and the part each edit places as the circuit names it ("R101" for R1 of S1). */
  sheets: { file: string; edits: Edit[]; parts: string[]; twins: Twin[][] }[]
  /** Instances moved as a whole: their pcbX/pcbY in the circuit shift by (dx, dy). */
  blocks: BlockMove[]
  /** Placed parts no edit can write, and why. */
  notes: string[]
}

/** One instance's copy of a sheet part: its circuit name ("R201") and the instance's path ("S2"). */
export interface Twin {
  part: string
  instance: string
}

type SetProps =Extract<Edit, { kind: "setProps" }>

const POSITION_PROPS = ["pcbX", "pcbY", "pcbRotation"] as const
const round = (v: number): number => Math.round(v * 10_000) / 10_000 || 0
const normal = (degrees: number): number => round((((degrees % 360) + 360) % 360))

/** A point turned by `degrees` counter-clockwise, exact for quarter turns. */
function turned(x: number, y: number, degrees: number): { x: number; y: number } {
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) {
    const [cos, sin] = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[((quarter % 4) + 4) % 4] as readonly [number, number]
    return { x: x * cos - y * sin, y: x * sin + y * cos }
  }
  const r = (degrees * Math.PI) / 180
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) }
}

/** The part's own props for a board position: the inverse of how the build puts a written position on the board. */
function propsFor(component: Component, at: PlacedPosition, turn: number): SetProps["props"] {
  const local = turned(at.x - component.groupOffset.pcb.x, at.y - component.groupOffset.pcb.y, -turn)
  return { pcbX: round(local.x), pcbY: round(local.y), pcbRotation: normal(at.rotation - turn) }
}

/**
 * The edits that put each part of `positions` (board coordinates, as the placer gives them) where it says. A sheet
 * holds one position per part for every instance of it, so a second instance's part is left out with a note.
 */
export function placementWrites(design: Design, positions: ReadonlyMap<string, PlacedPosition>, blocks: readonly BlockMove[] = []): PlacementWrites {
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  const instances = design.circuit.instances ?? []
  const circuit: Edit[] = []
  const sheets = new Map<string, { edits: Edit[]; parts: string[]; twins: Twin[][] }>()
  const twinsOf = (file: string, local: string): Twin[] =>
    design.circuit.components.flatMap((c) => {
      const owner = c.instance === undefined || c.localId !== local ? undefined : instances.find((one) => one.path === c.instance)
      return owner?.file === file ? [{ part: c.id, instance: owner.path }] : []
    })
  const owners = new Map<string, string>()
  const notes: string[] = []
  for (const name of [...positions.keys()].sort(naturalCompare)) {
    const component = components.get(name)
    const at = positions.get(name) as PlacedPosition
    if (!component) {
      notes.push(`${name} was not written: the circuit has no such part`)
      continue
    }
    if (component.instance === undefined) {
      circuit.push({ kind: "setProps", part: name, props: propsFor(component, at, 0) })
      continue
    }
    const instance = instances.find((one) => one.path === component.instance)
    const local = component.localId
    if (!instance || local === undefined) {
      notes.push(`${name} was not written: its sub-sheet instance was not found`)
      continue
    }
    const key = `${instance.file}\0${local}`
    const owner = owners.get(key)
    if (owner !== undefined) {
      notes.push(`${name} was not written: it is ${local} of ${instance.file}, whose position ${owner} gives every instance`)
      continue
    }
    owners.set(key, `${name} (${instance.path})`)
    const sheet = sheets.get(instance.file) ?? { edits: [], parts: [], twins: [] }
    sheets.set(instance.file, {
      edits: [...sheet.edits, { kind: "setProps", part: local, props: propsFor(component, at, frameTurn(instances, instance.path)) }],
      parts: [...sheet.parts, name],
      twins: [...sheet.twins, twinsOf(instance.file, local)],
    })
  }
  return { circuit, sheets: [...sheets].map(([file, sheet]) => ({ file, ...sheet })), blocks: [...blocks], notes }
}

export interface WritePlacementOptions {
  author: Author
  summary: string
  /** Runs first inside the project's write queue: a throw stops the write. The Studio checks there that the files are still those it placed from. */
  guard?: () => Promise<void>
  /** Fits the board round the parts after placing them, with this margin in mm, in the same entry. */
  fit?: { margin: number }
}

export interface WrittenPlacement {
  /** The history entry; absent when nothing changed. */
  entry?: HistoryEntry
  /** The parts whose positions were written, as the circuit names them, in natural order. */
  written: string[]
  /** Parts left as they were, and why ("R2 is locked"). */
  skipped: string[]
  /** The board fitted round the parts, or why it could not be. */
  board?: FitBoard
}

/** Why the source cannot take a part's position props, or undefined when it can. */
function refusal(model: CircuitModel, part: string, locked: ReadonlySet<string>): string | undefined {
  if (locked.has(part)) return "is locked"
  const info = model.parts.find((p) => p.name === part)
  if (!info) return "has no element of its own in the code"
  if (!info.editable) return `is read-only (${info.readonlyReason ?? "not a literal element"})`
  const expression = POSITION_PROPS.find((key) => info.props[key] && !info.props[key]?.editable)
  return expression ? `has ${expression} written as an expression` : undefined
}

/** The edits the source can take, with the circuit's name of each part; the others are named in `skipped`. */
function writable(model: CircuitModel, edits: readonly Edit[], names: readonly string[], locked: ReadonlySet<string>, skipped: string[]): { edits: SetProps[]; names: string[] } {
  const kept = edits.flatMap((edit, i) => {
    if (edit.kind !== "setProps") return []
    const why = refusal(model, edit.part, locked)
    if (why === undefined) return [{ edit, name: names[i] ?? edit.part }]
    skipped.push(`${names[i] ?? edit.part} ${why}`)
    return []
  })
  return { edits: kept.map((one) => one.edit), names: kept.map((one) => one.name) }
}

/** Whether a copy is locked: by its own name, or by the lock on its instance or any instance round it. */
function twinLocked(twin: Twin, locked: ReadonlySet<string>): boolean {
  if (locked.has(twin.part)) return true
  const steps = twin.instance.split("/")
  return steps.some((_, i) => locked.has(steps.slice(0, i + 1).join("/")))
}

/**
 * A sheet's edits less those whose part is locked in any instance: the sheet holds one position for every instance,
 * so writing it would move the locked copy too. Each one left out is named in `skipped`.
 */
function unlockedTwins(sheet: PlacementWrites["sheets"][number], locked: ReadonlySet<string>, skipped: string[]): { edits: Edit[]; parts: string[] } {
  const kept = sheet.edits.flatMap((edit, i) => {
    const name = sheet.parts[i] ?? ""
    const held = (sheet.twins[i] ?? []).find((twin) => twinLocked(twin, locked))
    if (!held) return [{ edit, name }]
    const local = edit.kind === "setProps" ? edit.part : name
    skipped.push(held.part === name ? `${name} is locked` : `${name} shares ${local} of ${sheet.file} with ${held.part}, which is locked`)
    return []
  })
  return { edits: kept.map((one) => one.edit), parts: kept.map((one) => one.name) }
}

/** A position prop's value in mm: 0 when it is not written, undefined when it is not a plain number. */
function lengthOf(prop: PropInfo | undefined): number | undefined {
  if (prop === undefined) return 0
  const value = prop.literal
  if (typeof value === "number") return value
  return typeof value === "string" && /^-?\d+(\.\d+)?(mm)?$/.test(value.trim()) ? Number.parseFloat(value) : undefined
}

/** The edits that shift each moved instance's anchor; an instance that is locked, holds a locked part or cannot take the props is named in `skipped`. */
function blockEdits(model: CircuitModel, blocks: readonly BlockMove[], locked: ReadonlySet<string>, skipped: string[]): { edits: SetProps[]; names: string[] } {
  const edits: SetProps[] = []
  const names: string[] = []
  for (const block of blocks) {
    const held = block.parts.find((part) => locked.has(part))
    const why = refusal(model, block.instance, locked) ?? (held ? `holds ${held}, which is locked` : undefined)
    const props = model.parts.find((p) => p.name === block.instance)?.props ?? {}
    const [x, y] = [lengthOf(props["pcbX"]), lengthOf(props["pcbY"])]
    if (why !== undefined || x === undefined || y === undefined) {
      skipped.push(`${block.instance} ${why ?? "has a position that is not a plain number"}`)
      continue
    }
    edits.push({ kind: "setProps", part: block.instance, props: { pcbX: round(x + block.dx), pcbY: round(y + block.dy) } })
    names.push(...block.parts)
  }
  return { edits, names }
}

interface Texts {
  circuit: { path: string; file: string; source: string; after: string }
  sheets: (FileChange & { path: string })[]
}

/** The board fitted round the parts as the files would be after the write, and its edit; or why not. */
async function fitted(root: string, texts: Texts, fit: { margin: number }): Promise<{ board: FitBoard; edit?: Edit }> {
  const files = { ...(await collectProjectFiles(root, { include: ENGINE_FILES })), [texts.circuit.file]: texts.circuit.after }
  for (const sheet of texts.sheets) files[sheet.file] = sheet.after
  const design = buildDesign(files, texts.circuit.file)
  const board = fitBoard(design, fit.margin)
  if ("error" in board) return { board }
  return { board, edit: { kind: "setBoard", width: board.width, height: board.height, x: board.centre.x, y: board.centre.y } }
}

/** Writes the changed files as one entry: the circuit as its file when it changed, else the first sheet file. */
async function record(root: string, texts: Texts, meta: { author: Author; summary: string }): Promise<HistoryEntry | undefined> {
  const { circuit } = texts
  const sheets = texts.sheets.map(({ path: _path, ...change }) => change)
  if (circuit.after !== circuit.source) {
    const also = alsoField(sheets)
    return sheetFilesFirst(root, sheets, "after", () => writeWithHistory(root, circuit, circuit.after, { ...meta, file: circuit.file, before: circuit.source, after: circuit.after, ...also }))
  }
  const [main, ...rest] = texts.sheets
  if (!main) return undefined
  const loaded = { path: main.path, file: main.file, source: main.before }
  return sheetFilesFirst(root, rest, "after", () => writeWithHistory(root, loaded, main.after, { ...meta, file: main.file, before: main.before, after: main.after, ...alsoField(rest.map(({ path: _p, ...change }) => change)) }))
}

/**
 * Writes the placement into the circuit `file` and its sheet files as one history entry. The locks are read inside the
 * project's write queue, after `guard`: a part locked meanwhile, read-only or with its position written as an
 * expression stays as it is and is named in `skipped`; so does a sheet part whose copy in any instance is locked.
 * Nothing changed: no entry.
 */
export function writePlacement(root: string, file: string, writes: PlacementWrites, options: WritePlacementOptions): Promise<WrittenPlacement> {
  return inProjectQueue(root, async () => {
    assertMeta(options)
    await options.guard?.()
    const loaded = await loadCircuit(root, file)
    const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
    const skipped: string[] = []
    const own = writable(loaded.model, writes.circuit, writes.circuit.map((edit) => (edit.kind === "setProps" ? edit.part : "")), locked, skipped)
    const moves = blockEdits(loaded.model, writes.blocks, locked, skipped)
    const written = [...own.names, ...moves.names]
    let after = applyEdits(loaded.source, [...own.edits, ...moves.edits], locked)
    const sheets: Texts["sheets"] = []
    for (const sheet of writes.sheets) {
      const resolved = await resolveCircuit(root, sheet.file)
      const before = await readFile(resolved.path, "utf8")
      const model = (await loadCircuit(root, resolved.file)).model
      const free = unlockedTwins(sheet, locked, skipped)
      const kept = writable(model, free.edits, free.parts, new Set(), skipped)
      const text = applyEdits(before, kept.edits, new Set())
      if (text !== before) sheets.push({ path: resolved.path, file: resolved.file, before, after: text })
      written.push(...kept.names)
    }
    const texts: Texts = { circuit: { path: loaded.path, file: loaded.file, source: loaded.source, after }, sheets }
    const fit = options.fit ? await fitted(root, texts, options.fit) : undefined
    if (fit?.edit) {
      after = applyEdits(after, [fit.edit], locked)
      texts.circuit.after = after
    }
    const entry = await record(root, texts, { author: options.author, summary: options.summary })
    return { ...(entry ? { entry } : {}), written: written.sort(naturalCompare), skipped, ...(fit ? { board: fit.board } : {}) }
  })
}
