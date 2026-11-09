import { posix } from "node:path"
import { z } from "zod"
import {
  applyEdits,
  BUILTIN_PARTS,
  EditError,
  loadCircuit,
  type Edit,
  type Literal,
} from "../core/index.js"
import { componentName, LIBRARY_OWNED_PROPS, libraryIds, PARTS_DIR } from "../core/library.js"
import { netsOf, pinName } from "./compact.js"

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

async function placeEdit(root: string, file: string, request: { part: string; name: string; props?: Record<string, Literal> | undefined }): Promise<Edit> {
  const extra = request.props ? { props: request.props } : {}
  if ((BUILTIN_PARTS as readonly string[]).includes(request.part)) return { kind: "addPart", tag: request.part, name: request.name, ...extra }
  if (!(await libraryIds(root)).includes(request.part)) {
    throw new Error(`Unknown part "${request.part}": use a library part id from list_parts or one of ${BUILTIN_PARTS.join(", ")}`)
  }
  const owned = Object.keys(request.props ?? {}).find((key) => LIBRARY_OWNED_PROPS.includes(key))
  if (owned) throw new Error(`${owned} comes from ${PARTS_DIR}/${request.part}/part.yaml; change it there`)
  const tag = componentName(request.part)
  let importFrom = posix.relative(posix.dirname(file), `${PARTS_DIR}/${request.part}/${tag}`)
  if (!importFrom.startsWith(".")) importFrom = `./${importFrom}`
  return { kind: "addPart", tag, name: request.name, importFrom, ...extra }
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
      return { edit: await placeEdit(root, file, item.place_part!), label: `place ${item.place_part!.name}` }
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
  return [
    `Edit ${refusal.index + 1} of ${total} (${kind}) was refused: ${refusal.reason}`,
    `${before} edit${before === 1 ? "" : "s"} before it were fine, but nothing was written: the batch is all or nothing.`,
  ].join("\n")
}

/** Applies edits one at a time in memory to find the first one the core refuses; nothing is written. */
export async function firstRefusal(root: string, file: string, edits: Edit[]): Promise<Refusal | undefined> {
  const loaded = await loadCircuit(root, file)
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  let source = loaded.source
  for (const [index, edit] of edits.entries()) {
    try {
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

/** One connect per pin on each named net, skipping pins already on that net. */
export async function planNets(root: string, file: string, nets: Record<string, string[]>): Promise<NetPlan> {
  const existing = netsOf((await loadCircuit(root, file)).model.traces)
  const plan: NetPlan = { edits: [], added: {}, skipped: 0 }
  for (const [name, pins] of Object.entries(nets)) {
    if (!NET_NAME.test(name)) throw new Error(`"${name}" is not a net name; use letters, digits, _ and -, e.g. GND`)
    const onNet = new Set(existing.filter((net) => net.names.includes(name)).flatMap((net) => net.pins))
    for (const pin of new Set(pins.map((p) => p.trim()))) {
      if (!PIN.test(pin)) throw new Error(`"${pin}" is not a pin selector; write PART.pin, e.g. R1.pin2 or U1.VOUT`)
      if (onNet.has(pinName(pin))) plan.skipped += 1
      else {
        plan.edits.push({ kind: "addTrace", from: pin, to: `net.${name}` })
        plan.added[name] = (plan.added[name] ?? 0) + 1
      }
    }
  }
  return plan
}
