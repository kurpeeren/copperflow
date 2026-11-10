import type { CopperLayer } from "../core/layout-file.js"
import { padsUnder, viaSpan } from "../engine/copper.js"
import type { Design } from "../engine/design.js"
import type { Net, Point } from "../engine/model.js"

/** A piece of copper that holds a point. */
export interface CopperHit {
  kind: "pad" | "track" | "via"
  id: string
  /** The net id the copper carries; none for copper on no net. */
  net?: string
}

const EPSILON = 1e-9

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const onTrack = (p: Point, points: readonly Point[], width: number): boolean =>
  points.some((a, i) => {
    const b = points[i + 1]
    return b !== undefined && distanceToSegment(p, a, b) <= width / 2 + EPSILON
  })

/** Everything whose copper holds `point` on any of `layers`: pads, tracks and vias, pads first, then in file order. */
export function copperAt(design: Pick<Design, "pcb">, point: Point, layers: readonly CopperLayer[]): CopperHit[] {
  const hits: CopperHit[] = []
  const seen = new Set<string>()
  for (const layer of layers) {
    for (const pad of padsUnder(design.pcb.parts, point, layer)) {
      if (!seen.has(pad.id)) hits.push({ kind: "pad", id: pad.id, ...(pad.net === undefined ? {} : { net: pad.net }) })
      seen.add(pad.id)
    }
  }
  for (const track of design.pcb.tracks) {
    if (layers.includes(track.layer) && onTrack(point, track.points, track.width)) hits.push({ kind: "track", id: track.id, ...(track.net === undefined ? {} : { net: track.net }) })
  }
  for (const via of design.pcb.vias) {
    const span = viaSpan(via)
    const reaches = layers.some((layer) => span.has(layer))
    if (reaches && Math.hypot(point.x - via.at.x, point.y - via.at.y) <= via.diameter / 2 + EPSILON) hits.push({ kind: "via", id: via.id, ...(via.net === undefined ? {} : { net: via.net }) })
  }
  return hits
}

/** The net a user means by `name`: its id, its id without "net.", or one of its names. */
export function findNet(nets: readonly Net[], name: string): Net | undefined {
  return nets.find((net) => net.id === name || net.id === `net.${name}` || net.names.includes(name))
}

/** A net id as a person reads it: the net's first name, else the id; "no net" for none. */
export function netLabel(nets: readonly Net[], id: string | undefined): string {
  if (id === undefined) return "no net"
  return nets.find((net) => net.id === id)?.names[0] ?? id
}
