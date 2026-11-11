// Edit → Copy (Ctrl+C) and Edit → Paste (Ctrl+V), as plain data. Copy keeps the selected parts as written (their tag,
// literal props and pin labels) and the traces among them (or from them to a named net), with their hand-drawn corners.
// Paste writes them back as new parts with designators renumbered to the next free (R1 → R4 when R1 to R3 are taken),
// placed a little to the right and below on both views, and the traces renamed to follow: one list of addPart and
// addTrace edits, so one history entry. Props written as expressions cannot be carried and are named. Pure.
import { parseSelector } from "../../../src/engine/selectors.js"
import { parseLength } from "../../../src/engine/units.js"
import type { CircuitModel, Edit, Literal, Point } from "../../../src/core/types.js"

export interface CopiedPart {
  tag: string
  name: string
  props: Record<string, Literal>
  pinLabels?: Record<string, string>
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

/** Copy: the selected parts as written and the traces whose ends are those parts' pins or named nets. */
export function copyParts(model: Pick<CircuitModel, "parts" | "traces">, names: readonly string[]): Clipboard | { message: string } {
  const picked = model.parts.filter((part) => names.includes(part.name))
  if (picked.length === 0) return { message: "Select the parts to copy first." }
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
    return { tag: part.tag, name: part.name, props, ...(pinLabels ? { pinLabels } : {}) }
  })
  const chosen = new Set(picked.map((part) => part.name))
  const traces = model.traces.flatMap((trace): CopiedTrace[] => {
    const ends = [endPart(trace.from), endPart(trace.to)]
    if (ends.some((end) => end === null)) return []
    const parts = ends.filter((end): end is string => typeof end === "string")
    if (parts.length === 0 || parts.some((part) => !chosen.has(part))) return []
    const props = Object.fromEntries(Object.entries(trace.props).flatMap(([key, prop]) => (TRACE_OWN.has(key) || prop.literal === undefined ? [] : [[key, prop.literal]])))
    return [{ from: trace.from as string, to: trace.to as string, props, ...(trace.schematicRouteHints ? { hints: trace.schematicRouteHints } : {}) }]
  })
  return { parts, traces, left }
}

const DESIGNATOR = /^([A-Za-z_]+?)(\d+)$/

/** The next free name for each copied part: same letters, the lowest number above every taken one of that prefix. */
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

/** A position prop moved by the paste offset; a PCB length written with a unit becomes mm. Other props stay. */
function moved(key: string, value: Literal): Literal {
  const by = key === "schX" ? PASTE_OFFSET.sch : key === "schY" ? -PASTE_OFFSET.sch : key === "pcbX" ? PASTE_OFFSET.pcb : key === "pcbY" ? -PASTE_OFFSET.pcb : undefined
  if (by === undefined) return value
  const number = key.startsWith("pcb") ? parseLength(value) : typeof value === "number" ? value : undefined
  return number === undefined ? value : tidy(number + by)
}

/** A trace end with its part renamed. */
function renamedEnd(end: string, names: ReadonlyMap<string, string>): string {
  const parsed = parseSelector(end)
  return parsed?.kind === "pin" ? `${names.get(parsed.part) ?? parsed.part}.${parsed.pin}` : end
}

/** Paste: the clipboard's parts and traces as edits on `page`, named after what the file has, with the summary. */
export function pasteEdits(clip: Clipboard, model: Pick<CircuitModel, "parts" | "drawings">, page?: string): { edits: Edit[]; summary: string; names: string[] } {
  const taken = [...model.parts.map((part) => part.name), ...model.drawings.flatMap((drawing) => [drawing.id, drawing.name ?? ""])]
  const names = pasteNames(clip.parts.map((part) => part.name), taken)
  const onPage = page === undefined || page === "Main" ? {} : { page }
  const parts = clip.parts.map((part): Edit => ({
    kind: "addPart",
    tag: part.tag,
    name: names.get(part.name) as string,
    props: Object.fromEntries(Object.entries(part.props).map(([key, value]) => [key, moved(key, value)])),
    ...(part.pinLabels ? { pinLabels: part.pinLabels } : {}),
    ...onPage,
  }))
  const traces = clip.traces.map((trace): Edit => ({
    kind: "addTrace",
    from: renamedEnd(trace.from, names),
    to: renamedEnd(trace.to, names),
    ...(Object.keys(trace.props).length > 0 ? { props: trace.props } : {}),
    ...(trace.hints ? { schematicRouteHints: trace.hints.map((p) => ({ x: tidy(p.x + PASTE_OFFSET.sch), y: tidy(p.y - PASTE_OFFSET.sch) })) } : {}),
    ...onPage,
  }))
  const list = [...names.values()]
  return { edits: [...parts, ...traces], summary: `paste ${list.length === 1 ? list[0] : `${list.length} parts (${list.join(", ")})`}`, names: list }
}
