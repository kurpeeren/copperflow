import { generateFootprint } from "../engine/footprints/index.js"
import { kindOf, pinSpecs } from "../engine/kinds.js"
import { analyzeCircuit } from "./analyze.js"
import { applyEdits } from "./edit.js"
import { libraryIds, readPart } from "./library.js"
import { MAIN_PAGE } from "../engine/model.js"
import { checkPageName } from "./page-edits.js"
import { BUILTIN_PARTS, placeEdit } from "./place.js"
import type { CircuitModel, Edit, Literal } from "./types.js"

export interface NewPart {
  name: string
  /** A built-in part such as "resistor". Give this or `part`. */
  kind?: string
  /** A library part id from list_parts. Give this or `kind`. */
  part?: string
  /** The kind's main value: resistance, capacitance, ... */
  value?: Literal
  footprint?: string
  /** Literal props, and `pinLabels` as an object (`{ pin1: "cathode" }`) to rename the pins of a built-in part. */
  props?: Record<string, Literal | Record<string, string>>
}

export interface NewCircuit {
  parts: NewPart[]
  /** Net name to the pins on it, each written PART.pin. */
  nets: Record<string, string[]>
  board?: { width: number; height: number }
  /** Schematic pages after the first ("Main"), in order, each with the names of its parts; a part in none is on Main. */
  pages?: { name: string; parts: string[] }[]
}

export const DEFAULT_BOARD = { width: 30, height: 20 }
const PART_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const NET_NAME = /^[A-Za-z_][\w-]*$/
const PIN_SELECTOR = /^([A-Za-z][A-Za-z0-9_]*)\.([\w-]+)$/
const MAX_BOARD = 1000
/** Kinds without a library entry. A chip or connector has the pins its pinLabels, pinCount or footprint give it. */
const PLAIN_KINDS: readonly string[] = [...BUILTIN_PARTS, "chip", "connector"]

/** What a part is, and the names each of its pins answers to (pin 1 first). */
interface PartPins {
  description: string
  pins: string[][]
}
type PinTable = Map<string, PartPins>

function boardSkeleton(board: { width: number; height: number }): string {
  return `export default () => (\n  <board width="${board.width}mm" height="${board.height}mm">\n  </board>\n)\n`
}

function checkBoard(board: { width: number; height: number }): void {
  for (const [label, size] of [["width", board.width], ["height", board.height]] as const) {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BOARD) throw new Error(`Board ${label} must be a number of mm above 0 and at most ${MAX_BOARD}`)
  }
}

function checkKind(part: NewPart): void {
  if ((part.kind === undefined) === (part.part === undefined)) {
    throw new Error(`${part.name}: give exactly one of kind (a built-in part) or part (a library part id)`)
  }
  if (part.kind !== undefined && !PLAIN_KINDS.includes(part.kind)) {
    throw new Error(`${part.name}: unknown kind "${part.kind}"; use one of ${PLAIN_KINDS.join(", ")}, or part for a library part from list_parts`)
  }
}

interface PartProps {
  props: Record<string, Literal>
  pinLabels?: Record<string, string>
}

/** Splits props into literals and pinLabels; an object is accepted for pinLabels only. */
function splitProps(part: NewPart): PartProps {
  const props: Record<string, Literal> = {}
  let pinLabels: Record<string, string> | undefined
  for (const [key, value] of Object.entries(part.props ?? {})) {
    if (typeof value !== "object") props[key] = value
    else if (key !== "pinLabels") throw new Error(`${part.name}: props.${key} must be a string, number or boolean; only pinLabels takes an object`)
    else if (part.part !== undefined) throw new Error(`${part.name}: pin names come from parts/${part.part}/part.yaml; change them there`)
    else pinLabels = value
  }
  return pinLabels ? { props, pinLabels } : { props }
}

/** The props a part gets: its value, footprint and literal props, checked against each other. */
function propsOf(part: NewPart): PartProps {
  const { props, ...rest } = splitProps(part)
  if (part.value !== undefined) {
    const prop = part.kind === undefined ? undefined : kindOf(part.kind)?.valueProp
    if (!prop) throw new Error(`${part.name}: ${part.kind ?? "a library part"} has no value; use props for anything else`)
    if (prop in props) throw new Error(`${part.name}: value and props.${prop} both set ${prop}; give one`)
    props[prop] = part.value
  }
  if (part.footprint !== undefined) {
    if (part.part !== undefined) throw new Error(`${part.name}: the footprint comes from parts/${part.part}/part.yaml; change it there`)
    props.footprint = part.footprint
  }
  return { props, ...rest }
}

/** How many pins the engine gives a footprint: pads with one number are one pin. */
function footprintPins(footprint: Literal | undefined): number | undefined {
  if (typeof footprint !== "string") return undefined
  const made = generateFootprint(footprint)
  return "error" in made ? undefined : new Set(made.pads.map((pad) => pad.number)).size
}

async function pinsOf(root: string, part: NewPart, own: PartProps): Promise<PartPins> {
  if (part.kind !== undefined) {
    const { props, pinLabels } = own
    const padCount = footprintPins(props.footprint)
    const specs = pinSpecs(part.kind, { pinLabels, pinCount: props.pinCount, polarized: props.polarized === true, padCount })
    return { description: part.kind, pins: specs.map((spec) => spec.names) }
  }
  const id = part.part as string
  if (!(await libraryIds(root)).includes(id)) {
    throw new Error(`${part.name}: Unknown part "${id}": use a library part id from list_parts or kind for one of ${BUILTIN_PARTS.join(", ")}`)
  }
  try {
    const numbered = Object.entries((await readPart(root, id)).pins).sort(([a], [b]) => Number(a) - Number(b))
    return { description: id, pins: numbered.map(([number, pin]) => [pin.name, `pin${number}`]) }
  } catch (error) {
    throw new Error(`${part.name}: part "${id}" cannot be read (${(error as Error).message}); see list_parts`)
  }
}

async function checkParts(root: string, parts: NewPart[]): Promise<{ table: PinTable; props: Map<string, PartProps> }> {
  const table: PinTable = new Map()
  const props = new Map<string, PartProps>()
  for (const part of parts) {
    if (!PART_NAME.test(part.name)) throw new Error(`"${part.name}" is not a valid part name; use letters, digits and _, starting with a letter, e.g. R1`)
    if (table.has(part.name)) throw new Error(`Two parts are named ${part.name}; names must be unique`)
    checkKind(part)
    const own = propsOf(part)
    props.set(part.name, own)
    table.set(part.name, await pinsOf(root, part, own))
  }
  return { table, props }
}

/** The pin number a selector means on its part, or throws naming the part's real pins. */
function pinNumber(table: PinTable, selector: string): { part: string; number: number } {
  const match = PIN_SELECTOR.exec(selector)
  if (!match) throw new Error(`"${selector}" is not a pin selector; write PART.pin, e.g. R1.pin2 or U1.VOUT`)
  const [, part = "", pin = ""] = match
  const known = table.get(part)
  if (!known) throw new Error(`${selector}: there is no part ${part}; the parts are ${[...table.keys()].join(", ")}`)
  const found = known.pins.flatMap((names, index) => (names.includes(pin) ? [index + 1] : []))
  if (found.length > 1) throw new Error(`${selector}: ${part} has several pins named ${pin} (${found.map((n) => `pin${n}`).join(", ")}); write pin<n> instead`)
  if (found[0] !== undefined) return { part, number: found[0] }
  const real = known.pins.length > 0 ? known.pins.map((names) => names.join("/")).join(", ") : "none yet (give props.pinCount)"
  throw new Error(`${selector}: ${part} (${known.description}) has no pin "${pin}"; its pins are ${real}`)
}

/** Each net's pins, checked: a pin on two nets or an unknown pin throws; a pin repeated on one net is kept once. */
function checkNets(table: PinTable, nets: Record<string, string[]>): Map<string, string[]> {
  const claimed = new Map<string, string>()
  const clean = new Map<string, string[]>()
  for (const [name, pins] of Object.entries(nets)) {
    if (!NET_NAME.test(name)) throw new Error(`"${name}" is not a net name; use letters, digits, _ and -, e.g. GND`)
    const written: string[] = []
    for (const selector of pins.map((pin) => pin.trim())) {
      const { part, number } = pinNumber(table, selector)
      const key = `${part}.${number}`
      const other = claimed.get(key)
      if (other !== undefined && other !== name) throw new Error(`${selector} is on both ${other} and ${name}; a pin can be on one net only`)
      if (other === undefined) written.push(selector)
      claimed.set(key, name)
    }
    clean.set(name, written)
  }
  return clean
}

/** The page of each part named in `pages`, checked: every page has a usable new name, every part is known and on one page. */
function checkPages(table: PinTable, pages: NewCircuit["pages"]): Map<string, string> {
  const pageOf = new Map<string, string>()
  const names = new Set<string>()
  for (const { name, parts } of pages ?? []) {
    checkPageName(name)
    if (name === MAIN_PAGE) throw new Error(`Parts in no page are on ${MAIN_PAGE}; leave ${MAIN_PAGE} out of pages`)
    if (names.has(name)) throw new Error(`Two pages are named ${name}`)
    names.add(name)
    for (const part of parts) {
      if (!table.has(part)) throw new Error(`Page ${name}: there is no part ${part}; the parts are ${[...table.keys()].join(", ")}`)
      const other = pageOf.get(part)
      if (other !== undefined) throw new Error(`${part} is on both page ${other} and page ${name}; a part is on one page`)
      pageOf.set(part, name)
    }
  }
  return pageOf
}

/** The edit that adds one part. A chip or connector has no library entry, so it is added directly. */
async function partEdit(root: string, circuit: { file: string; model: CircuitModel }, part: NewPart, own: PartProps, page: string | undefined): Promise<Edit> {
  const labels = own.pinLabels ? { pinLabels: own.pinLabels } : {}
  const onPage = page === undefined ? {} : { page }
  if (part.kind === "chip" || part.kind === "connector") return { kind: "addPart", tag: part.kind, name: part.name, props: own.props, ...labels, ...onPage }
  const { edit } = await placeEdit(root, circuit, { part: part.kind ?? (part.part as string), name: part.name, props: own.props, ...onPage })
  return { ...edit, ...labels }
}

/** The text of a new circuit file (`file` is its project-relative path, with `/`), or throws why the netlist cannot be written. Reads the parts library, writes nothing. */
export async function generateCircuit(root: string, file: string, spec: NewCircuit): Promise<{ text: string; traces: number }> {
  const board = spec.board ?? DEFAULT_BOARD
  checkBoard(board)
  if (spec.parts.length === 0) throw new Error("A circuit needs at least one part")
  const { table, props } = await checkParts(root, spec.parts)
  const nets = checkNets(table, spec.nets)
  const pageOf = checkPages(table, spec.pages)
  const skeleton = boardSkeleton(board)
  const circuit = { file, model: analyzeCircuit(skeleton) }
  // Each page is written once, in the order given, so the pages keep that order; Main stays the board itself.
  const edits: Edit[] = (spec.pages ?? []).map((page): Edit => ({ kind: "addPage", name: page.name }))
  for (const part of spec.parts) edits.push(await partEdit(root, circuit, part, props.get(part.name) ?? { props: {} }, pageOf.get(part.name)))
  const traceOnPage = (from: string) => {
    const page = pageOf.get(from.split(".")[0] ?? "")
    return page === undefined ? {} : { page }
  }
  const traces: Edit[] = [...nets].flatMap(([net, selectors]) => selectors.map((from): Edit => ({ kind: "addTrace", from, to: `net.${net}`, ...traceOnPage(from) })))
  return { text: applyEdits(skeleton, [...edits, ...traces], new Set()), traces: traces.length }
}
