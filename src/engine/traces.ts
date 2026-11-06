import { diagnostic } from "./diagnostics.js"
import type { Component, Connection, Diagnostic, Pin, Point, SourceRef } from "./model.js"
import { netNode, pinNode } from "./nets.js"
import { naturalCompare } from "./order.js"
import { PropReader, type Props } from "./read-props.js"
import { parseSelector } from "./selectors.js"

export interface TraceDraft {
  props: Props
  source: SourceRef
}

export interface ResolvedTraces {
  connections: Connection[]
  /** Graph nodes that must exist as nets, including named nets whose trace failed on the other end. */
  nodes: Set<string>
  links: [string, string][]
  diagnostics: Diagnostic[]
}

/** A resolved end may carry a warning: the name it used is shared by several pins. */
type Endpoint = { ok: true; id: string; node: string; warning?: Diagnostic } | { ok: false; node?: string; problem: Diagnostic }

function resolveEndpoint(prop: string, value: unknown, byId: ReadonlyMap<string, Component>, source: SourceRef): Endpoint {
  const text = typeof value === "string" ? value : undefined
  const parsed = text === undefined ? undefined : parseSelector(text)
  if (text === undefined || !parsed) {
    const message = text === undefined ? `trace needs a ${prop}` : `Cannot read "${text}" as a pin or net`
    return { ok: false, problem: diagnostic("bad-selector", "error", message, [text ?? prop], source) }
  }
  if (parsed.kind === "net") return { ok: true, id: `net.${parsed.name}`, node: netNode(parsed.name) }
  const component = byId.get(parsed.part)
  if (!component) {
    return { ok: false, problem: diagnostic("unknown-part", "error", `There is no part ${parsed.part}`, [parsed.part], source) }
  }
  const matches = component.pins.filter((candidate) => candidate.names.includes(parsed.pin))
  const pin = matches[0]
  if (!pin) return { ok: false, problem: unknownPin(component, parsed.pin, source) }
  const warning = matches.length > 1 ? ambiguousPin(component, parsed.pin, matches, source) : undefined
  return { ok: true, id: pin.id, node: pinNode(pin.id), ...(warning ? { warning } : {}) }
}

function unknownPin(component: Component, name: string, source: SourceRef): Diagnostic {
  const real = component.pins.map((p) => p.names[0] ?? "").sort(naturalCompare).join(", ")
  const message = `${component.id} has no pin ${name} (${real === "" ? "it has no pins" : `pins: ${real}`})`
  return diagnostic("unknown-pin", "error", message, [`${component.id}.${name}`], source)
}

/** The selector keeps connecting to the first pin with the name, as it always has; the warning says which. */
function ambiguousPin(component: Component, name: string, matches: readonly Pin[], source: SourceRef): Diagnostic {
  const selector = `${component.id}.${name}`
  const pins = matches.map((p) => p.names[0] ?? "").join(", ")
  const message = `${component.id} has more than one pin named ${name} (${pins}); ${selector} connects to ${matches[0]?.names[0] ?? ""}`
  return diagnostic("ambiguous-pin", "warning", message, [selector], source)
}

function corners(value: unknown): Point[] | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value.flatMap((item) => {
    const { x, y } = (item ?? {}) as { x?: unknown; y?: unknown }
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
  })
  return points.length > 0 ? points : undefined
}

/**
 * Turns trace elements into connections. A trace with a bad end is reported and left out. A pin
 * name shared by several pins is reported once, however many traces use it.
 */
export function resolveTraces(drafts: readonly TraceDraft[], components: readonly Component[]): ResolvedTraces {
  const byId = new Map(components.map((component) => [component.id, component]))
  const seen = new Map<string, number>()
  const warned = new Set<string>()
  const result: ResolvedTraces = { connections: [], nodes: new Set(), links: [], diagnostics: [] }
  for (const { props, source } of drafts) {
    const from = resolveEndpoint("from", props["from"], byId, source)
    const to = resolveEndpoint("to", props["to"], byId, source)
    for (const end of [from, to]) {
      if (!end.ok) result.diagnostics.push(end.problem)
      else if (end.node.startsWith("net:")) result.nodes.add(end.node)
      const warning = end.ok ? end.warning : undefined
      if (warning && !warned.has(warning.items.join())) {
        warned.add(warning.items.join())
        result.diagnostics.push(warning)
      }
    }
    if (!from.ok || !to.ok) continue
    result.nodes.add(from.node).add(to.node)
    result.links.push([from.node, to.node])
    const base = `${from.id}|${to.id}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const built = connection(count === 1 ? base : `${base}#${count}`, from.id, to.id, props, source)
    result.connections.push(built.connection)
    result.diagnostics.push(...built.diagnostics)
  }
  return result
}

function connection(id: string, from: string, to: string, props: Props, source: SourceRef): { connection: Connection; diagnostics: Diagnostic[] } {
  const reader = new PropReader(props, id, source)
  const width = reader.length("thickness") ?? reader.length("width")
  const bends = corners(props["schematicRouteHints"])
  const built: Connection = { id, from, to, ...(width !== undefined ? { width } : {}), ...(bends ? { corners: bends } : {}), source }
  return { connection: built, diagnostics: reader.diagnostics }
}
