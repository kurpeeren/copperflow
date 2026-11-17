// The texts an imported KiCad board becomes: its library parts, the circuit file (board, parts in place, connections,
// pours, holes, keepouts) and the layout file (tracks and vias). Nothing is written here; import.ts writes them all as
// one change.
import { posix } from "node:path"
import { boardSkeleton } from "../../core/netlist.js"
import { applyEdits } from "../../core/edit.js"
import { serializeLayout, EMPTY_LAYOUT } from "../../core/layout-file.js"
import { applyLayoutRecordEdits, type LayoutEdit } from "../../core/layout-records.js"
import { componentName, partTexts, PARTS_DIR, FOOTPRINT_FILE } from "../../core/library.js"
import type { Author } from "../../core/history.js"
import type { Edit, Literal } from "../../core/types.js"
import type { KicadPart } from "./footprints.js"
import { baseId, footprintFileOf, partKey, planDesignators, planNets, planPins, valueSuffix, type PartPins, type PlannedNets } from "./plan.js"
import type { KicadBoard } from "./read.js"

export interface LibraryPart {
  id: string
  key: string
  /** The designators that use it, in natural order (R2 before R10). */
  used: string[]
  /** The files of the part, project-relative; empty when the library already had it, exactly. */
  files: { file: string; text: string }[]
  written: boolean
}

export interface PlannedImport {
  /** Designator per part, in the board's order. */
  names: string[]
  pins: PartPins[]
  nets: PlannedNets
  parts: LibraryPart[]
  /** Library part id per part, in the board's order. */
  partOf: string[]
  circuit: string
  layout: string
}

/** What the project's library already holds: each part id with its files' texts, to reuse or step around. */
export type Library = ReadonlyMap<string, ReadonlyMap<string, string>>

/** A part's notes for its checklist: where it came from, and what of it was drawn approximately. */
function notesFor(source: string, part: KicadPart): string[] {
  return [
    `This part came from an import of ${source}: compare every pad with the datasheet (position, size, drill), and every pin name and type`,
    ...part.pads.flatMap((pad) => (pad.approximated ? [`Pad ${pad.number || "(unnamed)"} was ${pad.approximated} in the file: draw it as the datasheet shows`] : [])),
  ]
}

const SAME_PART = (files: readonly { file: string; text: string }[], have: ReadonlyMap<string, string> | undefined) =>
  have !== undefined && have.size === files.length && files.every((f) => have.get(posix.basename(f.file)) === f.text)

/** The part's files under an id; undefined when the id cannot hold it (a different part has it). */
function filesUnder(id: string, source: string, part: KicadPart, pins: PartPins): { file: string; text: string }[] {
  const input = {
    title: part.value || baseId(part.footprint, ""),
    description: `Imported from ${source}: footprint ${part.footprint || "(unnamed)"}.`,
    origin: `kicad ${source}`,
    footprint: FOOTPRINT_FILE,
    pins: pins.pins,
  }
  return partTexts(id, input, { footprintFile: footprintFileOf(part, pins), notes: notesFor(source, part) }).files.map((f) => ({ file: `${PARTS_DIR}/${id}/${f.name}`, text: f.text }))
}

/** One library part per key, each with an id the library can hold: the same part already there is reused. */
function planParts(board: KicadBoard, pins: PartPins[], names: string[], source: string, library: Library): { parts: LibraryPart[]; partOf: string[] } {
  const groups = new Map<string, { first: number; used: string[] }>()
  board.parts.forEach((part, i) => {
    const key = partKey(part, pins[i] as PartPins)
    const group = groups.get(key) ?? { first: i, used: [] }
    group.used.push(names[i] as string)
    groups.set(key, group)
  })
  const bases = [...groups.values()].map((g) => baseId((board.parts[g.first] as KicadPart).footprint, (board.parts[g.first] as KicadPart).value))
  const taken = new Set<string>()
  const component = new Set<string>()
  const parts: LibraryPart[] = []
  const byKey = new Map<string, string>()
  ;[...groups].forEach(([key, group], g) => {
    const part = board.parts[group.first] as KicadPart
    const base = bases[g] as string
    const shared = bases.filter((b) => b === base).length > 1
    const suffix = valueSuffix(part.value)
    const first = shared && suffix !== "" ? `${base}-${suffix}` : base
    for (let n = 1; ; n++) {
      const id = n === 1 ? first : `${first}-${n}`
      if (taken.has(id.toLowerCase()) || component.has(componentName(id))) continue
      const files = filesUnder(id, source, part, pins[group.first] as PartPins)
      const have = [...library.keys()].find((other) => other.toLowerCase() === id.toLowerCase() || componentName(other) === componentName(id))
      if (have !== undefined && (have !== id || !SAME_PART(files, library.get(have)))) continue
      taken.add(id.toLowerCase())
      component.add(componentName(id))
      parts.push({ id, key, used: group.used, files: have === undefined ? files : [], written: have === undefined })
      byKey.set(key, id)
      break
    }
  })
  parts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const part of parts) part.used.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
  return { parts, partOf: board.parts.map((part, i) => byKey.get(partKey(part, pins[i] as PartPins)) as string) }
}

const num = (v: number) => Math.round(v * 10_000) / 10_000 || 0

/** The circuit's edits: the board's shape, every part in place, every connection, every pour. */
function circuitEdits(board: KicadBoard, plan: Omit<PlannedImport, "circuit" | "layout">, file: string): Edit[] {
  const edits: Edit[] = [{ kind: "setBoardShape", outline: board.board.outline, holes: board.board.holes, keepouts: board.board.keepouts, replace: false }]
  board.parts.forEach((part, i) => {
    const id = plan.partOf[i] as string
    const tag = componentName(id)
    let importFrom = posix.relative(posix.dirname(file), `${PARTS_DIR}/${id}/${tag}`)
    if (!importFrom.startsWith(".")) importFrom = `./${importFrom}`
    const props: Record<string, Literal> = { pcbX: num(part.at.x), pcbY: num(part.at.y) }
    if (part.rotation !== 0) props.pcbRotation = part.rotation
    if (part.side === "bottom") props.layer = "bottom"
    edits.push({ kind: "addPart", tag, name: plan.names[i] as string, importFrom, props })
  })
  const pinsOn = netPins(board, plan.names, plan.pins)
  for (const [net, pins] of pinsOn) {
    const name = plan.nets.names.get(net)
    if (name !== undefined) for (const pin of pins) edits.push({ kind: "addTrace", from: pin, to: `net.${name}` })
    else if (plan.nets.unnamed.has(net)) pins.slice(1).forEach((pin, j) => edits.push({ kind: "addTrace", from: pins[j] as string, to: pin }))
  }
  for (const pour of board.pours) {
    const name = plan.nets.names.get(pour.net)
    if (name === undefined) continue
    const props = Object.fromEntries(Object.entries(pour.props).filter(([key, v]) => v !== undefined && (key === "priority" || (v > 0 && v <= 10))))
    edits.push({ kind: "addPour", net: name, layer: pour.layer, outline: pour.outline, ...(Object.keys(props).length > 0 ? { props: props as Record<string, Literal> } : {}) })
  }
  return edits
}

/** Each file net with its pins as selectors (R1.pin2), each pin once, in the board's order. */
export function netPins(board: KicadBoard, names: readonly string[], pins: readonly PartPins[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  board.parts.forEach((part, i) => {
    part.pads.forEach((pad, p) => {
      if (!pad.net) return
      const selector = `${names[i]}.pin${(pins[i] as PartPins).padPins[p]}`
      const list = found.get(pad.net) ?? []
      if (!list.includes(selector)) list.push(selector)
      found.set(pad.net, list)
    })
  })
  return found
}

/** The layout file's text: every track and via, by `author`. */
function layoutText(board: KicadBoard, nets: PlannedNets, author: Author): string {
  const net = (name: string | undefined) => {
    const named = name === undefined ? undefined : nets.names.get(name)
    return named === undefined ? {} : { net: named }
  }
  const edits: LayoutEdit[] = [
    ...board.tracks.map((t): LayoutEdit => ({ kind: "addTrack", ...net(t.net), layer: t.layer, width: t.width, points: t.points })),
    ...board.vias.map((v): LayoutEdit => ({ kind: "addVia", ...net(v.net), at: v.at, drill: v.drill, diameter: v.diameter, layers: ["top", "bottom"] })),
  ]
  if (edits.length === 0) return ""
  return serializeLayout(applyLayoutRecordEdits(EMPTY_LAYOUT, edits, { author }).doc)
}

/** Every text the import writes, planned against the library the project has. */
export function planImport(board: KicadBoard, options: { source: string; file: string; library: Library; author: Author }): PlannedImport {
  const names = planDesignators(board.parts)
  const pins = board.parts.map(planPins)
  const pinsOn = netPins(board, names, pins)
  const nets = planNets(pinsOn)
  const { parts, partOf } = planParts(board, pins, names, options.source, options.library)
  const plan = { names, pins, nets, parts, partOf }
  const skeleton = boardSkeleton({ width: Math.max(board.board.width, 1), height: Math.max(board.board.height, 1) })
  return { ...plan, circuit: applyEdits(skeleton, circuitEdits(board, plan, options.file), new Set()), layout: layoutText(board, nets, options.author) }
}
