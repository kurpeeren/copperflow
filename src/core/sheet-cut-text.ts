// The two texts a sub-sheet made from a selection writes: the new sheet file (the parts copied as written, placed
// relative to the selection, the wires among them and the ports) and the edits of the parent (the parts and their
// wires removed, the crossing nets kept joined, and the instance in their place). Pure.
import MagicString from "magic-string"
import { naturalCompare } from "../engine/order.js"
import { parseSelector } from "../engine/selectors.js"
import { parseLength } from "../engine/units.js"
import { scanCircuit } from "./analyze.js"
import { applyEdits } from "./edit.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, lineIndent } from "./edit-text.js"
import { formatLiteral, formatPointList } from "./literals.js"
import type { CutPlan } from "./sheet-cut.js"
import type { CircuitModel, Edit, PartInfo, Point, PropValue, TraceInfo } from "./types.js"

/** Where the selection sits: the middle of its parts' written positions, per axis; an axis no part writes is absent. */
export interface CutOrigin {
  schX?: number
  schY?: number
  pcbX?: number
  pcbY?: number
}

const AXES = ["schX", "schY", "pcbX", "pcbY"] as const
type Axis = (typeof AXES)[number]

const round = (value: number, step: number): number => Math.round(value / step) * step
const tidy = (value: number): number => Math.round(value * 10_000) / 10_000 + 0

/** A position prop as a number (a PCB length in mm), undefined when it is not written, or throws when it cannot be read. */
function positionOf(part: PartInfo, axis: Axis): number | undefined {
  const prop = part.props[axis]
  if (!prop) return undefined
  const value = typeof prop.literal === "number" ? prop.literal : typeof prop.literal === "string" && axis.startsWith("pcb") ? parseLength(prop.literal) : undefined
  if (value === undefined || !Number.isFinite(value)) throw new EditError("invalid", `${part.name}.${axis} is written as ${prop.source}, which cannot be moved into a sheet; write it as a number first`)
  return value
}

/** The selection's position: the middle of its parts' written positions, on the 0.1 grid. */
export function cutOrigin(parts: readonly PartInfo[]): CutOrigin {
  const origin: CutOrigin = {}
  for (const axis of AXES) {
    const values = parts.flatMap((part) => positionOf(part, axis) ?? [])
    if (values.length > 0) origin[axis] = tidy(round((Math.min(...values) + Math.max(...values)) / 2, 0.1))
  }
  return origin
}

/** The instance's default name: the sheet's name and the lowest free number, PowerStage → PowerStage1 (F1 would read like a fuse). */
export function defaultInstanceName(sheet: string, model: CircuitModel): string {
  const initials = sheet
  const taken = new Set([...model.parts.map((p) => p.name), ...model.drawings.flatMap((d) => [d.id, d.name ?? ""]), ...model.imports.map((i) => i.local)])
  let n = 1
  while (taken.has(`${initials}${n}`)) n++
  return `${initials}${n}`
}

export interface InstanceSpec {
  sheet: string
  name: string
  base: number
  origin: CutOrigin
}

/** The parent's edits: the parts removed (their wires with them), the crossing nets kept joined, the instance added and placed. */
export function parentEdits(plan: CutPlan, instance: InstanceSpec): Edit[] {
  const page = plan.page === undefined ? {} : { page: plan.page }
  const place = Object.fromEntries(AXES.flatMap((axis) => (instance.origin[axis] === undefined ? [] : [[axis, instance.origin[axis]]])))
  return [
    ...plan.parts.map((part): Edit => ({ kind: "removePart", part: part.name })),
    ...plan.parentTraces.map((t): Edit => ({ kind: "addTrace", from: t.pin, to: `net.${t.net}`, ...(t.props ? { props: t.props } : {}), ...(t.page === undefined ? {} : { page: t.page }) })),
    { kind: "addInstance", tag: instance.sheet, name: instance.name, connections: plan.connections, base: instance.base, importFrom: `./${instance.sheet}.sheet`, ...page },
    ...(Object.keys(place).length === 0 ? [] : [{ kind: "setProps", part: instance.name, props: place } satisfies Edit]),
  ]
}

/** A trace end in the sheet: a part's new designator, a net under the port's name. */
function sheetEnd(end: string, names: ReadonlyMap<string, string>, nets: ReadonlyMap<string, string>): string {
  const parsed = parseSelector(end)
  if (!parsed) return end
  if (parsed.kind === "net") return `net.${nets.get(parsed.name) ?? parsed.name}`
  return `${names.get(parsed.part) ?? parsed.part}.${parsed.pin}`
}

const TRACE_OWN = new Set(["from", "to", "schematicRouteHints"])

/** A moved wire written anew: its ends renamed, its other props as written, its corners moved with the parts. */
function movedTrace(trace: TraceInfo, names: ReadonlyMap<string, string>, nets: ReadonlyMap<string, string>, origin: CutOrigin): string {
  const [from, to] = [trace.from, trace.to].map((end) => sheetEnd(end ?? "", names, nets))
  const others = Object.entries(trace.props).filter(([key]) => !TRACE_OWN.has(key)).map(([key, prop]) => ` ${key}=${prop.source}`)
  const hints = trace.schematicRouteHints?.map((p): Point => ({ x: tidy(p.x - (origin.schX ?? 0)), y: tidy(p.y - (origin.schY ?? 0)) }))
  const written = trace.props["schematicRouteHints"]
  const corners = hints && hints.length > 0 ? ` schematicRouteHints=${formatPointList(hints)}` : written && !hints ? ` schematicRouteHints=${written.source}` : ""
  return `<trace from=${formatLiteral(from ?? "")} to=${formatLiteral(to ?? "")}${others.join("")}${corners} />`
}

/** A part's element as written, its later lines indented as the first line now is. */
function partText(source: string, part: PartInfo, indent: string): string {
  const was = lineIndent(source, part.start) ?? ""
  const lines = source.slice(part.start, part.end).split(/\r?\n/)
  return lines.map((line, index) => (index === 0 ? indent + line : line.startsWith(was) ? indent + line.slice(was.length) : line)).join("\n")
}

/** The import statements the parts' tags need, as written in the circuit (a sheet sits beside it, so the paths hold). */
function importsFor(source: string, model: CircuitModel, parts: readonly PartInfo[]): string[] {
  const tags = new Set(parts.map((part) => part.tag))
  const statements = model.imports.filter((spec) => tags.has(spec.local)).map((spec) => source.slice(source.lastIndexOf("import", spec.end - 1), spec.end).trim())
  return [...new Set(statements)]
}

/** The parts' positions relative to the selection's, as setProps edits on the sheet. */
function relativePlaces(parts: readonly PartInfo[], origin: CutOrigin): Edit[] {
  return parts.flatMap((part) => {
    const props: Record<string, PropValue> = {}
    for (const axis of AXES) {
      const value = positionOf(part, axis)
      if (value !== undefined) props[axis] = tidy(value - (origin[axis] ?? 0))
    }
    return Object.keys(props).length === 0 ? [] : [{ kind: "setProps", part: part.name, props } satisfies Edit]
  })
}

/** Renames the parts in one pass (names may swap, R5 → R1 while R1 → R2), by their name attributes. */
function renameParts(text: string, mapping: CutPlan["mapping"]): string {
  const scan = scanCircuit(text)
  const out = new MagicString(text)
  for (const { from, to } of mapping) {
    const node = scan.partNodes.get(from)
    const attribute = node ? attributeNamed(text, node, "name") : undefined
    if (from === to || !attribute?.value) continue
    out.overwrite(attribute.value.start ?? 0, attribute.value.end ?? 0, formatLiteral(to))
  }
  return out.toString()
}

/** The new sheet file's text: imports, `export default function <Name>()` returning `<sheet>` with the ports, parts and wires. */
export function sheetSource(source: string, model: CircuitModel, plan: CutPlan, sheet: string, origin: CutOrigin): string {
  const names = new Map(plan.mapping.map(({ from, to }) => [from, to]))
  const indent = "      "
  const ports = plan.ports.map((port) => `${indent}<port name=${formatLiteral(port.name)}${port.bus ? " bus" : ""} />`)
  const parts = plan.parts.map((part) => partText(source, part, indent))
  const wires = plan.moved.map((trace) => indent + movedTrace(trace, names, plan.netNames, origin))
  const joins = [...plan.sheetTraces]
    .sort((a, b) => naturalCompare(a.pin, b.pin))
    .map((t) => {
      const props = Object.entries(t.props ?? {}).map(([key, value]) => ` ${key}=${formatLiteral(value)}`)
      return `${indent}<trace from=${formatLiteral(sheetEnd(t.pin, names, plan.netNames))} to=${formatLiteral(`net.${t.net}`)}${props.join("")} />`
    })
  const imports = importsFor(source, model, plan.parts)
  const text = [...imports, ...(imports.length > 0 ? [""] : []), `export default function ${sheet}() {`, "  return (", "    <sheet>", ...ports, ...parts, ...wires, ...joins, "    </sheet>", "  )", "}", ""].join("\n")
  return renameParts(applyEdits(text, relativePlaces(plan.parts, origin), new Set()), plan.mapping)
}
