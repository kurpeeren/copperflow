import { analyzeCircuit } from "./analyze.js"
import { applyEdits } from "./edit.js"
import { MAIN_PAGE } from "../engine/model.js"
import { checkPageName } from "./page-edits.js"
import { boardSkeleton, checkNets, checkParts, partEdit, type NewPart } from "./netlist.js"
import { planSheets, type NewInstance, type NewSheet } from "./new-circuit-sheets.js"
import type { Edit, Literal, Point } from "./types.js"

export type { NewPart } from "./netlist.js"
export type { NewInstance, NewSheet } from "./new-circuit-sheets.js"

export interface NewCircuit {
  parts: NewPart[]
  /** Net name to the pins on it, each written PART.pin. */
  nets: Record<string, string[]>
  /** The size in mm (30 x 20 unless given); kind "perfboard" or "stripboard" makes it a 2.54 mm hole grid that size. */
  board?: { width?: number | undefined; height?: number | undefined; kind?: "pcb" | "perfboard" | "stripboard" | undefined }
  /** Schematic pages after the first ("Main"), in order, each with the names of its parts and instances; one in none is on Main. */
  pages?: { name: string; parts: string[] }[]
  /** Sub-sheets written beside the circuit as `<name>.sheet.tsx`, by name. */
  sheets?: Record<string, NewSheet>
  /** Uses of sheets, each flattened into the circuit with its base added to every designator. */
  instances?: NewInstance[]
  /** Copper pours, each of a net the circuit has, on the top or bottom; without an outline one fills the board. */
  pours?: NewPour[]
  /** Non-plated holes, centre and diameter in mm. */
  holes?: { x: number; y: number; diameter: number }[]
}

export interface NewPour {
  net: string
  layer: string
  outline?: Point[]
  /** priority, clearance, minWidth, thermal, thermalWidth, thermalGap; checked as the core's addPour checks them. */
  props?: Record<string, Literal | undefined>
}

export const DEFAULT_BOARD = { width: 30, height: 20 }
const MAX_BOARD = 1000

function checkBoard(board: { width: number; height: number }): void {
  for (const [label, size] of [["width", board.width], ["height", board.height]] as const) {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BOARD) throw new Error(`Board ${label} must be a number of mm above 0 and at most ${MAX_BOARD}`)
  }
}

/** The page of each part or instance named in `pages`, checked: every page has a usable new name, every name is known and on one page. */
function checkPages(known: ReadonlySet<string>, pages: NewCircuit["pages"]): Map<string, string> {
  const pageOf = new Map<string, string>()
  const names = new Set<string>()
  for (const { name, parts } of pages ?? []) {
    checkPageName(name)
    if (name === MAIN_PAGE) throw new Error(`Parts in no page are on ${MAIN_PAGE}; leave ${MAIN_PAGE} out of pages`)
    if (names.has(name)) throw new Error(`Two pages are named ${name}`)
    names.add(name)
    for (const part of parts) {
      if (!known.has(part)) throw new Error(`Page ${name}: there is no part ${part}; the parts are ${[...known].join(", ")}`)
      const other = pageOf.get(part)
      if (other !== undefined) throw new Error(`${part} is on both page ${other} and page ${name}; a part is on one page`)
      pageOf.set(part, name)
    }
  }
  return pageOf
}

/** The pours' and holes' edits: each pour on a net the circuit names, on a layer of its two-layer board. */
function boardItemEdits(spec: NewCircuit, nets: ReadonlySet<string>): Edit[] {
  const pours = (spec.pours ?? []).map((pour, index): Edit => {
    if (!nets.has(pour.net)) throw new Error(`Pour ${index + 1}: there is no net ${pour.net}; the nets are ${[...nets].join(", ")}`)
    if (pour.layer !== "top" && pour.layer !== "bottom") throw new Error(`Pour ${index + 1}: a new circuit's board has two layers, so the layer is top or bottom`)
    const props = Object.fromEntries(Object.entries(pour.props ?? {}).filter((entry): entry is [string, Literal] => entry[1] !== undefined))
    return { kind: "addPour", net: pour.net, layer: pour.layer, ...(pour.outline ? { outline: pour.outline } : {}), ...(Object.keys(props).length > 0 ? { props } : {}) }
  })
  return [...pours, ...(spec.holes ?? []).map((hole): Edit => ({ kind: "addHole", x: hole.x, y: hole.y, diameter: hole.diameter }))]
}

/** A new circuit file's text and the sheet files written with it. */
export interface GeneratedCircuit {
  text: string
  traces: number
  /** Project-relative paths with `/`, beside the circuit. */
  sheets: { file: string; text: string }[]
  /** The instances as written, each with its base. */
  instances: GeneratedInstance[]
}

export interface GeneratedInstance {
  name: string
  sheet: string
  base: number
  connections: Record<string, string>
}

/**
 * The text of a new circuit file (`file` is its project-relative path, with `/`) and of its sheet files, or throws
 * why the netlist cannot be written. Reads the parts library and the sheet files already there, writes nothing.
 */
export async function generateCircuit(root: string, file: string, spec: NewCircuit): Promise<GeneratedCircuit> {
  const board = { width: spec.board?.width ?? DEFAULT_BOARD.width, height: spec.board?.height ?? DEFAULT_BOARD.height, kind: spec.board?.kind }
  checkBoard(board)
  if (board.kind !== undefined && board.kind !== "pcb" && (spec.pours ?? []).length > 0) throw new Error(`A ${board.kind} has no copper pours; leave pours out`)
  if (spec.parts.length === 0 && (spec.instances ?? []).length === 0) throw new Error("A circuit needs at least one part or instance")
  const { table, props } = await checkParts(root, spec.parts)
  const planned = await planSheets(root, file, spec, [...table.keys()])
  const instances = new Set(planned.instances.map((edit) => edit.name))
  const asInstance = (part: string, selector: string) =>
    instances.has(part) ? `${selector}: ${part} is an instance; join its ports to nets with connections` : undefined
  const nets = checkNets(table, spec.nets, asInstance)
  const pageOf = checkPages(new Set([...table.keys(), ...instances]), spec.pages)
  const skeleton = boardSkeleton(board)
  const circuit = { file, model: analyzeCircuit(skeleton) }
  // Each page is written once, in the order given, so the pages keep that order; Main stays the board itself.
  const edits: Edit[] = (spec.pages ?? []).map((page): Edit => ({ kind: "addPage", name: page.name }))
  for (const part of spec.parts) edits.push(await partEdit(root, circuit, part, props.get(part.name) ?? { props: {} }, pageOf.get(part.name)))
  for (const instance of planned.instances) {
    const page = pageOf.get(instance.name)
    edits.push(page === undefined ? instance : { ...instance, page })
  }
  const named = new Set([...Object.keys(spec.nets), ...planned.instances.flatMap((instance) => Object.values(instance.connections ?? {}))])
  edits.push(...boardItemEdits(spec, named))
  const traceOnPage = (from: string) => {
    const page = pageOf.get(from.split(".")[0] ?? "")
    return page === undefined ? {} : { page }
  }
  const traces: Edit[] = [...nets].flatMap(([net, selectors]) => selectors.map((from): Edit => ({ kind: "addTrace", from, to: `net.${net}`, ...traceOnPage(from) })))
  return { text: applyEdits(skeleton, [...edits, ...traces], new Set()), traces: traces.length, sheets: planned.files, instances: planned.instances.map(({ name, tag, base, connections }) => ({ name, sheet: tag, base: base ?? 0, connections })) }
}
