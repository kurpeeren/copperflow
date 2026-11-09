// What the PCB's track tool finds under the pointer: a via (first, as the copper pick does), a pad, then a track on
// the route's layer, met at its nearest point and, on a horizontal or vertical segment, on the grid while Snap is on
// (as the schematic wire tool meets a wire). Only what the Layer panel shows is found. Plain TypeScript with .js
// imports, so the tests can run it.
import type { CopperLayer } from "../../../src/core/layout-file.js"
import type { Design } from "../../../src/engine/design.js"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { copperShown } from "./copper-hit.js"
import { roundPosition, snapPosition, type Point } from "./geometry.js"
import type { LayerVisibility } from "./layers.js"
import { padAt } from "./pcb-draw.js"
import type { RouteTarget } from "./track-tool.js"
import { netName } from "./track-rules.js"

export interface TargetSource {
  design: Pick<Design, "circuit" | "pcb">
  /** The copper as shown, with each record's net id. */
  copper: {
    tracks: readonly { id: string; net?: string; layer: CopperLayer; width: number; points: readonly Point[] }[]
    vias: readonly { id: string; net?: string; at: Point; diameter: number }[]
  }
  visible: LayerVisibility
}

/** How a track is met: along it on the grid `step` while `snap` is on. */
export interface Meet {
  step: number
  snap: boolean
}

/** "U1.VIN": the part and the pin's own name when it has one, else `pinN`, else the pad's id. */
export function padName(design: Pick<Design, "circuit">, pad: WorldPad): string {
  const pin = design.circuit.components.find((c) => c.id === pad.component)?.pins.find((one) => one.id === pad.pin)
  const name = pin?.names.find((n) => !/^pin\d+$/.test(n)) ?? pin?.names[0]
  return name ? `${pad.component}.${name}` : pad.id
}

const named = (design: Pick<Design, "circuit">, net: string | undefined) => (net === undefined ? {} : { net, netName: netName(design, net) })

function viaTarget(source: TargetSource, p: Point, reach: number): RouteTarget | undefined {
  if (!copperShown({ kind: "via" }, source.visible)) return undefined
  const via = source.copper.vias.find((one) => Math.hypot(p.x - one.at.x, p.y - one.at.y) <= Math.max(one.diameter / 2, reach))
  return via && { kind: "via", id: via.id, at: via.at, ...named(source.design, via.net) }
}

function padTarget(source: TargetSource, p: Point): RouteTarget | undefined {
  const pad = padAt(source.design.pcb, p, source.visible)
  return pad && { kind: "pad", id: pad.id, label: padName(source.design, pad), part: pad.component, at: { x: pad.x, y: pad.y }, ...named(source.design, pad.net), layer: pad.layers }
}

/** The nearest point of segment a–b to `p`, moved along a horizontal or vertical segment to the grid while it stays on it. */
function meetOn(a: Point, b: Point, p: Point, meet: Meet | undefined): Point {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  const at = { x: roundPosition(a.x + t * dx), y: roundPosition(a.y + t * dy) }
  const axis = dy === 0 && dx !== 0 ? "x" : dx === 0 && dy !== 0 ? "y" : undefined
  if (!axis || !meet?.snap) return at
  const snapped = snapPosition(at[axis], meet.step)
  const inside = snapped >= Math.min(a[axis], b[axis]) && snapped <= Math.max(a[axis], b[axis])
  return inside ? { ...at, [axis]: snapped } : at
}

function trackTarget(source: TargetSource, p: Point, reach: number, layer: CopperLayer | undefined, meet: Meet | undefined): RouteTarget | undefined {
  let best: { track: TargetSource["copper"]["tracks"][number]; at: Point; d: number } | undefined
  for (const track of source.copper.tracks) {
    if ((layer !== undefined && track.layer !== layer) || !copperShown({ kind: "track", layer: track.layer }, source.visible)) continue
    for (let i = 1; i < track.points.length; i++) {
      const at = meetOn(track.points[i - 1] as Point, track.points[i] as Point, p, undefined)
      const d = Math.hypot(at.x - p.x, at.y - p.y)
      if (d <= Math.max(track.width / 2, reach) && (!best || d < best.d)) best = { track, at: meetOn(track.points[i - 1] as Point, track.points[i] as Point, p, meet), d }
    }
  }
  return best && { kind: "track", id: best.track.id, at: best.at, ...named(source.design, best.track.net), layer: best.track.layer }
}

/** The via, pad or track (on `layer`, or any layer when none is given) under `p` within `reach` mm. */
export function routeTargetAt(source: TargetSource, p: Point, reach: number, layer: CopperLayer | undefined, meet?: Meet): RouteTarget | undefined {
  return viaTarget(source, p, reach) ?? padTarget(source, p) ?? trackTarget(source, p, reach, layer, meet)
}
