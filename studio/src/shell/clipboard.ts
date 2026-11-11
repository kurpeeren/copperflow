// Edit → Copy (Ctrl+C) and Edit → Paste (Ctrl+V), as plain data. Copy keeps the selected parts as written (their tag,
// literal props and pin labels) and the traces among them (or from them to a named net), with their hand-drawn corners.
// Paste writes them back as new parts with designators renumbered to the lowest free number (instance parts count as
// taken), with the copy's middle at the pointer in the view it was pasted in (the other view, and a paste without a
// pointer, steps a little to the right and below for each paste, so two pastes do not land on each other), and the
// traces renamed to follow: one list of addPart and addTrace edits, so one history entry. A part's import comes along
// (another folder's relative path is refused). Props written as expressions and sub-sheet instances are named and left out. Pure.
import { parseSelector } from "../../../src/engine/selectors.js"
import { parseLength } from "../../../src/engine/units.js"
import type { CircuitModel, Edit, Literal, Point } from "../../../src/core/types.js"

export interface CopiedPart {
  tag: string
  name: string
  props: Record<string, Literal>
  pinLabels?: Record<string, string>
  /** Where the copied file imports the part's tag from, for a library part. */
  importFrom?: string
}

export interface CopiedTrace {
  from: string
  to: string
  props: Record<string, Literal>
  hints?: Point[]
}

export interface Clipboard {
  parts: CopiedPart[]
  traces: CopiedTrace[]
  /** Props written as expressions, which a paste leaves out: "U1.pinAttributes". */
  left: string[]
  /** The copied file's folder ("" at the project root, else ending in "/"), against which its import paths hold. */
  folder: string
  /** The middle of the copied parts' positions on each view. */
  anchor: { sch?: Point; pcb?: Point }
}

/** How far a paste lands from the copy: one schematic grid step of 0.1 is too close to see, so half an inch, and 2.54 mm. */
export const PASTE_OFFSET = { sch: 0.5, pcb: 2.54 }

const OWN_PROPS = new Set(["name", "pinLabels"])
const TRACE_OWN = new Set(["from", "to", "schematicRouteHints"])
const PIN_LABEL = /(pin\d+)\s*:\s*["']([A-Za-z_][\w]*)["']/g

/** `{{ pin1: "cathode" }}` read back as a record; undefined when the source is no such literal. */
function readPinLabels(source: string | undefined): Record<string, string> | undefined {
  if (!source) return undefined
  const labels = Object.fromEntries([...source.matchAll(PIN_LABEL)].map((match) => [match[1] as string, match[2] as string]))
  return Object.keys(labels).length > 0 ? labels : undefined
}

/** The parts named in a trace end: the one part of a pin, none of a net. */
function endPart(end: string | undefined): string | undefined | null {
  const parsed = end === undefined ? undefined : parseSelector(end)
  if (!parsed) return null
  return parsed.kind === "net" ? undefined : parsed.part
}

/** The folder a project-relative file is in, with a trailing "/", or "" at the root. */
const folderOf = (file: string): string => file.slice(0, file.lastIndexOf("/") + 1)

/** Copy: the selected parts as written and the traces whose ends are those parts' pins or named nets. */
export function copyParts(model: Pick<CircuitModel, "parts" | "traces" | "imports">, names: readonly string[], file = ""): Clipboard | { message: string } {
  const all = model.parts.filter((part) => names.includes(part.name))
  // A sub-sheet instance is written with a default import and its connections; Paste writes plain parts only.
  const instances = all.filter((part) => model.imports.some((spec) => spec.local === part.tag && /\.sheet(\.tsx)?$/.test(spec.source)))
  const picked = all.filter((part) => !instances.includes(part))
  if (picked.length === 0) return { message: instances.length > 0 ? "Sub-sheet instances are not copied; make another instance from the sheet instead." : "Select the parts to copy first." }
  const left: string[] = []
  const parts = picked.map((part): CopiedPart => {
    const props: Record<string, Literal> = {}
    for (const [key, prop] of Object.entries(part.props)) {
      if (OWN_PROPS.has(key)) continue
      if (prop.literal === undefined) left.push(`${part.name}.${key}`)
      else props[key] = prop.literal
    }
    const pinLabels = readPinLabels(part.props["pinLabels"]?.source)
    if (part.props["pinLabels"] && !pinLabels) left.push(`${part.name}.pinLabels`)
    const imported = model.imports.find((spec) => spec.local === part.tag)?.source
    return { tag: part.tag, name: part.name, props, ...(pinLabels ? { pinLabels } : {}), ...(imported ? { importFrom: imported } : {}) }
  })
  left.push(...instances.map((part) => `${part.name} (a sub-sheet instance)`))
  const chosen = new Set(picked.map((part) => part.name))
  const traces = model.traces.flatMap((trace): CopiedTrace[] => {
    const ends = [endPart(trace.from), endPart(trace.to)]
    if (ends.some((end) => end === null)) return []
    const parts = ends.filter((end): end is string => typeof end === "string")
    if (parts.length === 0 || parts.some((part) => !chosen.has(part))) return []
    const props = Object.fromEntries(Object.entries(trace.props).flatMap(([key, prop]) => (TRACE_OWN.has(key) || prop.literal === undefined ? [] : [[key, prop.literal]])))
    return [{ from: trace.from as string, to: trace.to as string, props, ...(trace.schematicRouteHints ? { hints: trace.schematicRouteHints } : {}) }]
  })
  return { parts, traces, left, folder: folderOf(file), anchor: anchorOf(parts) }
}

/** A number a position prop holds, in sheet units or mm. */
const positionOf = (key: string, value: Literal | undefined): number | undefined =>
  value === undefined ? undefined : key.startsWith("pcb") ? parseLength(value) : typeof value === "number" ? value : undefined

/** The middle of the copied parts' written positions, per view; a view no part is placed on has none. */
function anchorOf(parts: readonly CopiedPart[]): Clipboard["anchor"] {
  const middle = (x: string, y: string) => {
    const at = parts.flatMap((part) => {
      const [px, py] = [positionOf(x, part.props[x]), positionOf(y, part.props[y])]
      return px === undefined || py === undefined ? [] : [{ x: px, y: py }]
    })
    return at.length === 0 ? undefined : { x: at.reduce((s, p) => s + p.x, 0) / at.length, y: at.reduce((s, p) => s + p.y, 0) / at.length }
  }
  const sch = middle("schX", "schY")
  const pcb = middle("pcbX", "pcbY")
  return { ...(sch ? { sch } : {}), ...(pcb ? { pcb } : {}) }
}

const DESIGNATOR = /^([A-Za-z_]+?)(\d+)$/

/** The next free name for each copied part: same letters, the lowest number no part, drawing or instance part takes. */
export function pasteNames(copied: readonly string[], taken: readonly string[]): Map<string, string> {
  const used = new Set(taken)
  const names = new Map<string, string>()
  for (const name of copied) {
    const prefix = DESIGNATOR.exec(name)?.[1] ?? `${name}_`
    let n = 1
    while (used.has(`${prefix}${n}`)) n++
    const next = `${prefix}${n}`
    used.add(next)
    names.set(name, next)
  }
  return names
}

const tidy = (value: number): number => Math.round(value * 10_000) / 10_000 + 0

/** How far each view moves: to the pointer when it is given (the copy's middle lands there), else the paste offset times `count`. */
export interface PasteShift {
  sch: Point
  pcb: Point
}

/** Where a paste lands: at the pointer in the view it was given for, else stepped from the copy, one step per paste. */
export function pasteShift(clip: Clipboard, pointer: { view: "sch" | "pcb"; at: Point } | undefined, count: number): PasteShift {
  const step = (by: number): Point => ({ x: by * count, y: -by * count })
  const shift: PasteShift = { sch: step(PASTE_OFFSET.sch), pcb: step(PASTE_OFFSET.pcb) }
  const anchor = pointer ? clip.anchor[pointer.view] : undefined
  if (!pointer || !anchor) return shift
  return { ...shift, [pointer.view]: { x: tidy(pointer.at.x - anchor.x), y: tidy(pointer.at.y - anchor.y) } }
}

/** A position prop moved by the shift; a PCB length written with a unit becomes mm. Other props stay. */
function moved(key: string, value: Literal, shift: PasteShift): Literal {
  const by = key === "schX" ? shift.sch.x : key === "schY" ? shift.sch.y : key === "pcbX" ? shift.pcb.x : key === "pcbY" ? shift.pcb.y : undefined
  if (by === undefined) return value
  const number = positionOf(key, value)
  return number === undefined ? value : tidy(number + by)
}

/** A trace end with its part renamed. */
function renamedEnd(end: string, names: ReadonlyMap<string, string>): string {
  const parsed = parseSelector(end)
  return parsed?.kind === "pin" ? `${names.get(parsed.part) ?? parsed.part}.${parsed.pin}` : end
}

export interface PasteTarget {
  /** The open circuit file, project-relative. */
  file?: string
  page?: string
  /** Designators the file's parts do not hold but the design has: the parts sub-sheet instances bring in. */
  taken?: readonly string[]
  shift?: PasteShift
}

/** An import path as the target file needs it: the same path in the same folder; another folder's relative path is refused. */
function importFor(part: CopiedPart, clip: Clipboard, target: PasteTarget, model: Pick<CircuitModel, "imports">): string | undefined | { message: string } {
  if (!part.importFrom) return undefined
  const there = model.imports.find((spec) => spec.local === part.tag)
  if (there) return there.source === part.importFrom ? undefined : { message: `${part.tag} is imported from "${there.source}" here, not "${part.importFrom}"; paste into a file that imports it the same way` }
  if (folderOf(target.file ?? "") !== clip.folder) return { message: `${part.name} needs "${part.importFrom}", which is relative to another folder; paste it into a circuit in that folder, or add the import first` }
  return part.importFrom
}

/** Paste: the clipboard's parts and traces as edits on the target's page, named after what the design has, with the summary. */
export function pasteEdits(clip: Clipboard, model: Pick<CircuitModel, "parts" | "drawings" | "imports">, target: PasteTarget = {}): { edits: Edit[]; summary: string; names: string[] } | { message: string } {
  const taken = [...model.parts.map((part) => part.name), ...model.drawings.flatMap((drawing) => [drawing.id, drawing.name ?? ""]), ...(target.taken ?? [])]
  const names = pasteNames(clip.parts.map((part) => part.name), taken)
  const page = target.page
  const onPage = page === undefined || page === "Main" ? {} : { page }
  const shift = target.shift ?? pasteShift(clip, undefined, 1)
  const parts: Edit[] = []
  for (const part of clip.parts) {
    const importFrom = importFor(part, clip, target, model)
    if (typeof importFrom === "object") return importFrom
    parts.push({
      kind: "addPart",
      tag: part.tag,
      name: names.get(part.name) as string,
      props: Object.fromEntries(Object.entries(part.props).map(([key, value]) => [key, moved(key, value, shift)])),
      ...(part.pinLabels ? { pinLabels: part.pinLabels } : {}),
      ...(importFrom ? { importFrom } : {}),
      ...onPage,
    })
  }
  const traces = clip.traces.map((trace): Edit => ({
    kind: "addTrace",
    from: renamedEnd(trace.from, names),
    to: renamedEnd(trace.to, names),
    ...(Object.keys(trace.props).length > 0 ? { props: trace.props } : {}),
    ...(trace.hints ? { schematicRouteHints: trace.hints.map((p) => ({ x: tidy(p.x + shift.sch.x), y: tidy(p.y + shift.sch.y) })) } : {}),
    ...onPage,
  }))
  const list = [...names.values()]
  return { edits: [...parts, ...traces], summary: `paste ${list.length === 1 ? list[0] : `${list.length} parts (${list.join(", ")})`}`, names: list }
}
