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
import { parseSelector } from "../engine/selectors.js"
import type { Circuit, Component } from "../engine/model.js"
import { netsOf, pinName } from "./compact.js"

type LoadedModel = Awaited<ReturnType<typeof loadCircuit>>["model"]

const literal = z.union([z.string(), z.number(), z.boolean()])
const props = z.record(z.string(), literal)
const ends = { from: z.string(), to: z.string() }

/** One step of edit_circuit: exactly one of these keys is set. */
export const editItem = z
  .object({
    set_props: z.object({ part: z.string(), props }).optional(),
    connect: z.object(ends).optional(),
    disconnect: z.object(ends).optional(),
    place_part: z.object({ part: z.string(), name: z.string(), props: props.optional() }).optional(),
    remove_part: z.object({ part: z.string() }).optional(),
  })
  .describe("Exactly one of set_props, connect, disconnect, place_part, remove_part")
export type EditItem = z.infer<typeof editItem>

const KINDS = ["set_props", "connect", "disconnect", "place_part", "remove_part"] as const
const SUMMARY_LIMIT = 100

function kindOf(item: EditItem): (typeof KINDS)[number] {
  const present = KINDS.filter((kind) => item[kind] !== undefined)
  if (present.length !== 1) throw new Error(`Give exactly one of ${KINDS.join(", ")}`)
  return present[0] as (typeof KINDS)[number]
}

/** Turns one step into the core's edit, or throws why it cannot. */
export async function toEdit(root: string, file: string, item: EditItem): Promise<{ edit: Edit; label: string }> {
  switch (kindOf(item)) {
    case "set_props": {
      const { part, props: values } = item.set_props!
      return { edit: { kind: "setProps", part, props: values }, label: `set ${part} ${Object.keys(values).join(",")}` }
    }
    case "connect": {
      const { from, to } = item.connect!
      return { edit: { kind: "addTrace", from, to }, label: `connect ${from} -> ${to}` }
    }
    case "disconnect": {
      const { from, to } = item.disconnect!
      return { edit: { kind: "removeTrace", from, to }, label: `disconnect ${from} -> ${to}` }
    }
    case "place_part":
      return { edit: (await placeEdit(root, await loadCircuit(root, file), item.place_part!)).edit, label: `place ${item.place_part!.name}` }
    case "remove_part":
      return { edit: { kind: "removePart", part: item.remove_part!.part }, label: `remove ${item.remove_part!.part}` }
  }
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

export function batchSummary(labels: string[]): string {
  const text = `edit ${labels.join("; ")}`
  return text.length > SUMMARY_LIMIT ? `edit ${labels.length} changes: ${text.slice(5, SUMMARY_LIMIT - 20)}…` : text
}

const NET_NAME = /^[A-Za-z_][\w-]*$/
const PIN = /^([\w-]+\.[\w-]+|\.[\w-]+\s*>\s*\.[\w-]+)$/

export interface NetPlan {
  edits: Edit[]
  added: Record<string, number>
  skipped: number
}

/** The pin a selector means in the built design: the engine's rule, the first pin of the part with that name. */
function resolvePin(circuit: Circuit, selector: string): string | undefined {
  const parsed = parseSelector(selector)
  if (parsed?.kind !== "pin") return undefined
  const component: Component | undefined = circuit.components.find((c) => c.id === parsed.part)
  return component?.pins.find((pin) => pin.names.includes(parsed.pin))?.id
}

/** Which pins are on each named net, as the built design resolves them; the source traces when the build fails. */
async function pinsOnNets(root: string, file: string, engine: DesignSource | undefined): Promise<{ onNet: (name: string, pin: string) => boolean }> {
  try {
    const { circuit } = await buildWith(root, file, engine)
    return { onNet: (name, pin) => {
      const id = resolvePin(circuit, pin)
      return id !== undefined && circuit.nets.some((net) => net.names.includes(name) && net.pins.includes(id))
    } }
  } catch {
    const existing = netsOf((await loadCircuit(root, file)).model.traces)
    return { onNet: (name, pin) => existing.some((net) => net.names.includes(name) && net.pins.includes(pinName(pin))) }
  }
}

/** One connect per pin on each named net, skipping pins already on that net. */
export async function planNets(root: string, file: string, nets: Record<string, string[]>, engine?: DesignSource): Promise<NetPlan> {
  const { onNet } = await pinsOnNets(root, file, engine)
  const plan: NetPlan = { edits: [], added: {}, skipped: 0 }
  const claimed = new Map<string, string>()
  for (const [name, pins] of Object.entries(nets)) {
    if (!NET_NAME.test(name)) throw new Error(`"${name}" is not a net name; use letters, digits, _ and -, e.g. GND`)
    for (const pin of new Set(pins.map((p) => p.trim()))) {
      if (!PIN.test(pin)) throw new Error(`"${pin}" is not a pin selector; write PART.pin, e.g. R1.pin2 or U1.VOUT`)
      const key = pinName(pin)
      const other = claimed.get(key)
      if (other !== undefined && other !== name) throw new Error(`${pin} is given for both ${other} and ${name}; that would short the two nets`)
      claimed.set(key, name)
      if (onNet(name, pin)) plan.skipped += 1
      else {
        plan.edits.push({ kind: "addTrace", from: pin, to: `net.${name}` })
        plan.added[name] = (plan.added[name] ?? 0) + 1
      }
    }
  }
  return plan
}
