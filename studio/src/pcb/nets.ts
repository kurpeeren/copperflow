// Which pads and traces belong to the same electrical net, and which pad is under a point.
import type { Point } from "./geometry.js"

interface Element {
  type: string
  [key: string]: unknown
}

export interface Nets {
  ofPort(pcbPortId: string): string | undefined
  ofTrace(pcbTraceId: string): string | undefined
}

/** Groups source ports through source traces (union-find); pcb ports and traces map onto them. */
export function buildNets(json: Element[]): Nets {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string
    parent.set(key, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const e of json) {
    if (e.type !== "source_trace") continue
    const members = [
      ...((e.connected_source_port_ids as string[] | undefined) ?? []).map((id) => `port:${id}`),
      ...((e.connected_source_net_ids as string[] | undefined) ?? []).map((id) => `net:${id}`),
    ]
    const anchor = `trace:${String(e.source_trace_id)}`
    for (const member of members) union(member, anchor)
    if (members.length === 0) find(anchor)
  }
  const sourcePortOf = new Map<string, string>()
  const sourceTraceOf = new Map<string, string>()
  for (const e of json) {
    if (e.type === "pcb_port") sourcePortOf.set(String(e.pcb_port_id), String(e.source_port_id))
    if (e.type === "pcb_trace" && e.source_trace_id) sourceTraceOf.set(String(e.pcb_trace_id), String(e.source_trace_id))
  }
  return {
    ofPort: (id) => {
      const source = sourcePortOf.get(id)
      return source ? find(`port:${source}`) : undefined
    },
    ofTrace: (id) => {
      const source = sourceTraceOf.get(id)
      return source ? find(`trace:${source}`) : undefined
    },
  }
}

/** The pcb_port id of the SMT pad or plated hole under a world point. */
export function padAt(json: Element[], p: Point): string | undefined {
  for (const e of json) {
    if ((e.type !== "pcb_smtpad" && e.type !== "pcb_plated_hole") || typeof e.pcb_port_id !== "string") continue
    if (contains(e, p)) return e.pcb_port_id
  }
  return undefined
}

/** Point-in-pad test; rotated pads use their bounding box, polygons their points' bounds. */
function contains(e: Element, p: Point): boolean {
  const num = (key: string) => (typeof e[key] === "number" ? (e[key] as number) : 0)
  if (e.shape === "polygon" && Array.isArray(e.points)) {
    const xs = (e.points as Point[]).map((q) => q.x)
    const ys = (e.points as Point[]).map((q) => q.y)
    return p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.y >= Math.min(...ys) && p.y <= Math.max(...ys)
  }
  const dx = p.x - num("x")
  const dy = p.y - num("y")
  if (e.shape === "circle") {
    const radius = e.type === "pcb_smtpad" ? num("radius") : num("outer_diameter") / 2
    return Math.hypot(dx, dy) <= radius
  }
  const rotated = (num("ccw_rotation") / 90) % 2 === 1
  let width = num("width") || num("outer_width") || num("rect_pad_width")
  let height = num("height") || num("outer_height") || num("rect_pad_height")
  if (rotated) [width, height] = [height, width]
  return Math.abs(dx) <= width / 2 && Math.abs(dy) <= height / 2
}
