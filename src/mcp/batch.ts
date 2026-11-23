import { z } from "zod"
import {
  applyEdits,
  EditError,
  libraryIds,
  libraryImports,
  LIBRARY_OWNED_PROPS,
  loadCircuit,
  PARTS_DIR,
  placeEdit,
  type Edit,
} from "../core/index.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import { analyzeCircuit, scanCircuit } from "../core/analyze.js"
import { connectionsEdit, instanceEdit } from "../core/instance-requests.js"
import { movePartNote } from "../core/page-edits.js"
import { localNet, localNetRefusal, parseSelector } from "../engine/selectors.js"
import type { Circuit, Component, Net } from "../engine/model.js"
import { naturalCompare } from "../engine/order.js"
import { pinName } from "./compact.js"
import { findNet } from "./copper-under.js"
import { holeFields, pointText, pourFields } from "./pour-tools.js"
import { connectCorners, STEP_KEYS, stepEdit, type StepKey } from "./batch-steps.js"
import { addTextFields, textEdit } from "./text-tool.js"

type LoadedModel = Awaited<ReturnType<typeof loadCircuit>>["model"]

const literal = z.union([z.string(), z.number(), z.boolean()])
const props = z.record(z.string(), literal)
/** set_props also takes a point for schNameAt, schValueAt and pcbNameAt, and null to remove one of them. */
const setValues = z.record(z.string(), z.union([literal, z.object({ x: z.number(), y: z.number() }), z.null()]))
const ends = { from: z.string(), to: z.string() }
/** A newer step: its shape is checked in batch-steps.ts, which answers a wrong one with the right one. */
const step = z.record(z.string(), z.unknown()).optional()
const steps = Object.fromEntries(STEP_KEYS.map((key) => [key, step])) as Record<StepKey, typeof step>

/** One step of edit_circuit: exactly one of these keys is set. */
export const editItem = z
  .object({
    set_props: z
      .object({
        part: z.string(),
        props: setValues.describe(
          'Literal props (pcbX, pcbY, pcbRotation, schX, resistance, footprint, …); missing ones are added. schNameAt, schValueAt, pcbNameAt: label offsets { x, y }; noConnect: "pin3,pin10" flags pins meant to stay open; supplierPartNumbers: "jlcpcb:C25804". null removes these.',
        ),
      })
      .optional(),
    connect: z.object({ ...ends, corners: z.unknown().optional() }).optional(),
    disconnect: z.object(ends).optional().describe("A schematic trace, in either direction"),
    place_part: z
      .object({ part: z.string().describe('A library part id (list_parts) or a built-in kind (guide { topic: "writing-circuits" })'), name: z.string().describe("e.g. U2"), props: props.optional(), page: z.string().optional().describe('Made when missing; default "Main"') })
      .optional(),
    remove_part: z.object({ part: z.string() }).optional().describe("With every trace connected to it"),
    add_instance: z
      .object({
        sheet: z.string().describe("e.g. PowerStage"),
        name: z.string(),
        connections: z.record(z.string(), z.string()).optional().describe('e.g. { "VIN": "VBUS" }'),
        base: z.number().int().positive().optional(),
        page: z.string().optional(),
      })
      .optional(),
    set_connections: z.object({ instance: z.string(), connections: z.record(z.string(), z.string()).describe("Ports left out are open") }).optional(),
    move_to_page: z.object({ part: z.string().describe("Part or instance"), page: z.string() }).optional(),
    add_text: z
      .object(addTextFields)
      .optional()
      .describe("No layer: a note on a schematic page (default Main) at (x, y) sheet units; layer: board silkscreen at (x, y) mm, height default 1.5"),
    add_pour: z.object(pourFields).optional().describe("Copper of a net on one layer; it fills round other nets' copper on every build, and what it joins counts as routed: check the pads the answer gives"),
    remove_pour: z.object({ id: z.string() }).optional().describe('Locked pours are refused; one inside an instance ("PS1/copperpour:1") lives in its sheet file'),
    add_hole: z.object(holeFields).optional().describe("A non-plated mounting hole: no copper, no net"),
    remove_hole: z.object({ id: z.string() }).optional().describe('Locked holes are refused; one inside an instance ("PS1/hole:1") lives in its sheet file'),
    ...steps,
  })
  .describe("Exactly one key")
export type EditItem = z.infer<typeof editItem>

const KINDS = ["set_props", "connect", "disconnect", "place_part", "remove_part", "add_instance", "set_connections", "move_to_page", "add_pour", "remove_pour", "add_hole", "remove_hole", "add_text", ...STEP_KEYS] as const
const SUMMARY_LIMIT = 100

export function kindOf(item: EditItem): (typeof KINDS)[number] {
  const present = KINDS.filter((kind) => item[kind] !== undefined)
  if (present.length === 0) throw new Error(`This edit has none of the keys edit_circuit takes (${KINDS.join(", ")}). Copper, the board's size and shape, design rules and library parts are not edited through it: use route_track, autoroute, fit_board, set_rules, create_part or set_part_fields. The shapes of the keys are in guide { topic: "writing-circuits" }`)
  if (present.length !== 1) throw new Error(`Give exactly one of ${KINDS.join(", ")}`)
  return present[0] as (typeof KINDS)[number]
}

/** One step as the core's edit, its label for the history entry, and a line for the answer when the label is not enough. */
export interface StepEdit {
  edit: Edit
  label: string
  note?: string
}

/** Turns one step into the core's edit, or throws why it cannot. `earlier` are the edits of the steps before it. */
export async function toEdit(root: string, file: string, item: EditItem, earlier: readonly Edit[] = []): Promise<StepEdit> {
  switch (kindOf(item)) {
    case "set_props": {
      const { part, props: values } = item.set_props!
      return { edit: { kind: "setProps", part, props: values }, label: `set ${part} ${Object.keys(values).join(",")}` }
    }
    case "connect": {
      const { from, to, corners } = item.connect!
      const hints = connectCorners(corners)
      return { edit: { kind: "addTrace", from, to, ...(hints ? { schematicRouteHints: hints } : {}) }, label: `connect ${from} -> ${to}` }
    }
    case "disconnect": {
      const { from, to } = item.disconnect!
      return { edit: { kind: "removeTrace", from, to }, label: `disconnect ${from} -> ${to}` }
    }
    case "place_part":
      return { edit: (await placeEdit(root, await loadCircuit(root, file), item.place_part!)).edit, label: `place ${item.place_part!.name}` }
    case "remove_part":
      return { edit: { kind: "removePart", part: item.remove_part!.part }, label: `remove ${item.remove_part!.part}` }
    case "add_instance": {
      const { connections = {}, ...rest } = item.add_instance!
      const edit = await instanceEdit(root, await loadCircuit(root, file), { ...rest, connections }, earlier)
      return { edit, label: `add instance ${rest.name} (${rest.sheet})` }
    }
    case "set_connections": {
      const request = item.set_connections!
      return { edit: await connectionsEdit(root, await loadCircuit(root, file), request), label: `set ${request.instance} connections` }
    }
    case "move_to_page": {
      const { part, page } = item.move_to_page!
      return { edit: { kind: "movePartToPage", part, page }, label: `move ${part} to page ${page}` }
    }
    case "add_pour": {
      const { net, layer, outline, props: values } = item.add_pour!
      const props = Object.fromEntries(Object.entries(values ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string | number>
      const edit: Edit = { kind: "addPour", net, layer, ...(outline ? { outline } : {}), ...(Object.keys(props).length > 0 ? { props } : {}) }
      return { edit, label: `add pour ${net} ${layer}` }
    }
    case "remove_pour":
      return { edit: { kind: "removePour", id: item.remove_pour!.id }, label: `remove ${item.remove_pour!.id}` }
    case "add_hole": {
      const hole = item.add_hole!
      return { edit: { kind: "addHole", ...hole }, label: `add hole at ${pointText(hole.x, hole.y)}` }
    }
    case "remove_hole":
      return { edit: { kind: "removeHole", id: item.remove_hole!.id }, label: `remove ${item.remove_hole!.id}` }
    case "add_text": {
      // The label names the note or board text; a board text's ink box goes on a line of its own.
      const { edit, label } = await textEdit(root, { file, ...item.add_text! }, earlier)
      const named = label.split(", its ink")[0] ?? label
      return { edit, label: named, ...(named === label ? {} : { note: label }) }
    }
    default: {
      const key = kindOf(item) as StepKey
      const model = key === "add_drawing" ? (await loadCircuit(root, file)).model : { parts: [], traces: [], drawings: [], skipped: [], imports: [] }
      return stepEdit(key, item[key], model, earlier)
    }
  }
}

/**
 * What each move to a page leaves behind (the traces to other parts stay where they are written), read on the text as
 * it is just before that move, one line per move that leaves something.
 */
export function moveNotes(source: string, edits: readonly Edit[], locked: ReadonlySet<string>): string[] {
  const notes: string[] = []
  let text = source
  for (const edit of edits) {
    if (edit.kind === "movePartToPage") {
      const note = movePartNote(scanCircuit(text), edit.part, edit.page)
      if (note) notes.push(`${edit.part}: ${note}`)
    }
    try {
      text = applyEdits(text, [edit], locked)
    } catch {
      break
    }
  }
  return notes
}

export interface Refusal {
  /** Zero-based position of the edit that was refused. */
  index: number
  reason: string
}

export function describeRefusal(refusal: Refusal, total: number, kind: string): string {
  const before = refusal.index
  const count = before === 0 ? "No edits come before it" : before === 1 ? "1 edit before it was fine" : `${before} edits before it were fine`
  return `Edit ${refusal.index + 1} of ${total} (${kind}) was refused: ${refusal.reason}
${count}, and nothing was written: the batch is all or nothing.`
}

/** Applies edits one at a time in memory to find the first one the core refuses; nothing is written. */
/** The core's library check: a prop the library part owns cannot be set on an instance. */
function refuseLibraryOverride(model: LoadedModel, library: Map<string, string>, edit: Edit): void {
  if (edit.kind !== "setProps" && edit.kind !== "addPart") return
  const tag = edit.kind === "addPart" ? edit.tag : model.parts.find((p) => p.name === edit.part)?.tag
  const id = tag === undefined ? undefined : library.get(tag)
  const owned = Object.keys(edit.props ?? {}).find((key) => LIBRARY_OWNED_PROPS.includes(key))
  if (id && owned) throw new EditError("invalid", `${owned} comes from ${PARTS_DIR}/${id}/part.yaml; change it there`)
}

export async function firstRefusal(root: string, file: string, edits: Edit[]): Promise<Refusal | undefined> {
  const loaded = await loadCircuit(root, file)
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  const library = libraryImports(loaded.model, loaded.file, await libraryIds(root))
  let source = loaded.source
  for (const [index, edit] of edits.entries()) {
    try {
      refuseLibraryOverride(loaded.model, library, edit)
      source = applyEdits(source, [edit], locked)
    } catch (error) {
      if (error instanceof EditError) return { index, reason: error.message }
      throw error
    }
  }
  return undefined
}

/** Whether the circuit text writes a trace to `net.<name>`. */
const namedIn = (source: string, name: string) => analyzeCircuit(source).traces.some((trace) => trace.from === `net.${name}` || trace.to === `net.${name}`)

/**
 * The batch's pours checked against the built design: the first add_pour on a net that neither the design has nor an
 * earlier edit of the batch writes (the batch is applied in order, so a net it connects first is fine), or on an inner
 * layer of a 2-layer board, is the refusal. Otherwise the edits, each pour on a net of the design with the net's own
 * name (an alias or "net.GND" becomes "GND"). Nothing is refused or renamed when the design does not build.
 */
export async function checkPours(root: string, file: string, edits: readonly Edit[], engine?: DesignSource): Promise<{ refusal?: Refusal; edits: Edit[] }> {
  if (!edits.some((edit) => edit.kind === "addPour")) return { edits: [...edits] }
  let nets: readonly Net[]
  let layers: number
  try {
    const { circuit } = await buildWith(root, file, engine)
    nets = circuit.nets
    layers = circuit.board?.layers ?? 2
  } catch {
    return { edits: [...edits] }
  }
  const named = edits.map((edit): Edit => {
    if (edit.kind !== "addPour") return edit
    const net = findNet(nets, edit.net)
    return net ? { ...edit, net: net.names[0] ?? edit.net } : edit
  })
  const loaded = await loadCircuit(root, file)
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  let source = loaded.source
  for (const [index, edit] of edits.entries()) {
    if (edit.kind === "addPour" && !findNet(nets, edit.net) && !namedIn(source, edit.net)) return { refusal: { index, reason: `There is no net ${edit.net}; connect pins to it first` }, edits: named }
    if (edit.kind === "addPour" && layers === 2 && edit.layer.startsWith("inner")) return { refusal: { index, reason: `The board has 2 layers (top, bottom), so there is no ${edit.layer}` }, edits: named }
    try {
      source = applyEdits(source, [edit], locked)
    } catch {
      return { edits: named }
    }
  }
  return { edits: named }
}

export function batchSummary(labels: string[]): string {
  const text = `edit ${labels.join("; ")}`
  return text.length > SUMMARY_LIMIT ? `edit ${labels.length} changes: ${text.slice(5, SUMMARY_LIMIT - 20)}…` : text
}

const NET_NAME = /^[A-Za-z_][\w-]*$/
const PIN = /^([\w-]+\.[\w-]+|\.[\w-]+\s*>\s*\.[\w-]+)$/

export interface NetPlan {
  edits: Edit[]
  added: Record<string, number>
  /** The pins each net gets, as they were given. */
  pins: Record<string, string[]>
  skipped: number
}

/** The pin names an unknown pin's refusal lists; the rest are counted. */
const PIN_NAMES_SHOWN = 24

/** Why a pin selector names no pin in the built design, or undefined when it names one. */
function unknownPin(circuit: Circuit, selector: string): string | undefined {
  if (resolvePin(circuit, selector) !== undefined) return undefined
  const parsed = parseSelector(selector)
  if (parsed?.kind !== "pin") return undefined
  const component = circuit.components.find((c) => c.id === parsed.part)
  if (component === undefined) {
    const instance = circuit.instances?.some((one) => one.path === parsed.part)
    return `${selector} (${instance ? `${parsed.part} is a sub-sheet instance; connect its ports with edit_circuit set_connections` : `there is no part ${parsed.part}`})`
  }
  const names = component.pins.map((pin) => pin.names[0] ?? "").sort(naturalCompare)
  const more = names.length > PIN_NAMES_SHOWN ? ` … and ${names.length - PIN_NAMES_SHOWN} more` : ""
  return `${selector} (${component.id} has ${names.length === 0 ? "no pins" : `${names.slice(0, PIN_NAMES_SHOWN).join(", ")}${more}`})`
}

/** The pin a selector means in the built design: the engine's rule, the first pin of the part with that name. */
function resolvePin(circuit: Circuit, selector: string): string | undefined {
  const parsed = parseSelector(selector)
  if (parsed?.kind !== "pin") return undefined
  const component: Component | undefined = circuit.components.find((c) => c.id === parsed.part)
  return component?.pins.find((pin) => pin.names.includes(parsed.pin))?.id
}

/** The built design's circuit; add_trace's nets cannot tell what is connected without it. */
async function builtCircuit(root: string, file: string, engine: DesignSource | undefined): Promise<Circuit> {
  try {
    return (await buildWith(root, file, engine)).circuit
  } catch {
    throw new Error("The circuit does not build, so add_trace cannot tell which pins are already connected: fix the build errors first (check_circuit)")
  }
}

/** One connect per pin on each named net, skipping pins already on that net. */
export async function planNets(root: string, file: string, nets: Record<string, string[]>, engine?: DesignSource): Promise<NetPlan> {
  const circuit = await builtCircuit(root, file, engine)
  const onNet = (name: string, pin: string) => {
    const id = resolvePin(circuit, pin)
    return id !== undefined && circuit.nets.some((net) => net.names.includes(name) && net.pins.includes(id))
  }
  const plan: NetPlan = { edits: [], added: {}, pins: {}, skipped: 0 }
  const claimed = new Map<string, string>()
  const unknown: string[] = []
  for (const [name, pins] of Object.entries(nets)) {
    const local = localNet(`net.${name}`)
    if (local) throw new Error(localNetRefusal(local, circuit.instances?.find((instance) => instance.path === local.instance)?.file))
    if (!NET_NAME.test(name)) throw new Error(`"${name}" is not a net name; use letters, digits, _ and -, e.g. GND`)
    for (const pin of new Set(pins.map((p) => p.trim()))) {
      if (!PIN.test(pin)) throw new Error(`"${pin}" is not a pin selector; write PART.pin, e.g. R1.pin2 or U1.VOUT`)
      const why = unknownPin(circuit, pin)
      if (why !== undefined) {
        unknown.push(why)
        continue
      }
      const key = resolvePin(circuit, pin) ?? pinName(pin)
      const other = claimed.get(key)
      if (other !== undefined && other !== name) throw new Error(`${pin} is given for both ${other} and ${name}; that would short the two nets`)
      claimed.set(key, name)
      if (onNet(name, pin)) plan.skipped += 1
      else {
        plan.edits.push({ kind: "addTrace", from: pin, to: `net.${name}` })
        plan.added[name] = (plan.added[name] ?? 0) + 1
        plan.pins[name] = [...(plan.pins[name] ?? []), pin]
      }
    }
  }
  if (unknown.length > 0) throw new Error(`Unknown pins; nothing was written: ${unknown.join("; ")}`)
  return plan
}
