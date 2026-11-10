// Where the pointer is on the PCB's copper: the via or track under it (vias first, then the nearest track; pads and
// part bodies come after both), and what a press grabs of a track (its segment, or a corner handle of the track
// selected alone). A track is reached as a schematic wire is: 6 CSS pixels from its centre line, or 2 past its edge
// where it is drawn wider. The Layer panel's rows and the Filter tab decide what may be picked. Plain TypeScript with
// .js imports, so the tests can run it.
import type { PcbTrack, PcbVia } from "../../../src/engine/pcb.js"
import { areasInBox, type BoxMode } from "./box-select.js"
import { roundPosition, type Box, type Point } from "./geometry.js"
import type { LayerVisibility } from "./layers.js"
import { canPick, type PickContext } from "./pick.js"
import type { TrackSegment } from "../selection.js"
import { cornerAt, distanceToSegment, segmentAt, WIRE_REACH_PX } from "./wire-hit.js"
import { handleReach, type WireGrip } from "./wire-drag.js"

/** A track as the hit test and the drawing see it. */
export type TrackShape = Pick<PcbTrack, "id" | "layer" | "width" | "points" | "missingLayer">
/** A via as the hit test sees it. */
export type ViaShape = Pick<PcbVia, "id" | "at" | "diameter" | "missingLayer">

/** The copper drawn on the board, in file order. */
export interface CopperShapes {
  tracks: readonly TrackShape[]
  vias: readonly ViaShape[]
}

/** The copper under the pointer. */
export type CopperHit = { kind: "track" | "via"; id: string }

/** What a press grabs of a track: a segment (from point `index` to the next) or the corner at point `index`. */
export type CopperGrip = WireGrip

/** A track or via as copperShown sees it; `missingLayer` marks copper on a layer the board lacks. */
export type ShownCopper = ({ kind: "track"; layer: PcbTrack["layer"] } | { kind: "via" }) & { missingLayer?: PcbTrack["layer"] }

/** The `missingLayer` of copper that has one, to spread into a ShownCopper. */
export const stray = (item: { missingLayer?: PcbTrack["layer"] }): { missingLayer?: PcbTrack["layer"] } =>
  item.missingLayer === undefined ? {} : { missingLayer: item.missingLayer }

/**
 * Whether a track or via is drawn with these layers shown: a track on its copper layer's row (inner layers have no row
 * yet, so they are not drawn), a via on Multi-Layer's, as a plated pad is. Copper on a layer the board lacks is an
 * error drawn in the keepout colour, so it follows the Keepout row.
 */
export function copperShown(item: ShownCopper, visible: LayerVisibility): boolean {
  if (item.missingLayer !== undefined) return visible.keepout
  if (item.kind === "via") return visible.multiLayer
  return (item.layer === "top" || item.layer === "bottom") && visible[item.layer]
}

/** How far past a drawn edge the pointer still reaches copper, in CSS pixels. */
const PAST_EDGE_PX = 2

/** How far from a track's centre line (or a via's centre) the pointer reaches it, in mm: 6 px, or 2 px past its edge. */
export const copperReach = (width: number, scale: number): number => Math.max(WIRE_REACH_PX, (width * scale) / 2 + PAST_EDGE_PX) / scale

function viaUnder(vias: readonly ViaShape[], p: Point, scale: number, visible: LayerVisibility, context: PickContext): CopperHit | undefined {
  const hit = vias.find((via) => copperShown({ kind: "via", ...stray(via) }, visible) && canPick({ kind: "via", id: via.id }, context) && Math.hypot(p.x - via.at.x, p.y - via.at.y) <= copperReach(via.diameter, scale))
  return hit && { kind: "via", id: hit.id }
}

/** The distance from `p` to the nearest segment of `points`. */
function distanceTo(points: readonly Point[], p: Point): number {
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1] as Point, points[i] as Point))
  return best
}

function trackUnder(tracks: readonly TrackShape[], p: Point, scale: number, visible: LayerVisibility, context: PickContext): CopperHit | undefined {
  let best: { id: string; distance: number } | undefined
  for (const track of tracks) {
    if (!copperShown({ kind: "track", layer: track.layer, ...stray(track) }, visible) || !canPick({ kind: "track", id: track.id }, context)) continue
    const distance = distanceTo(track.points, p)
    if (distance <= copperReach(track.width, scale) && (!best || distance < best.distance)) best = { id: track.id, distance }
  }
  return best && { kind: "track", id: best.id }
}

/** The via under `p`, else the nearest track in reach, among those shown and pickable; `scale` is CSS pixels per mm. */
export function copperAt(shapes: CopperShapes, p: Point, scale: number, visible: LayerVisibility, context: PickContext): CopperHit | undefined {
  return viaUnder(shapes.vias, p, scale, visible, context) ?? trackUnder(shapes.tracks, p, scale, visible, context)
}

/**
 * The segment a double click at `p` picks: the one under the pointer of the track copperAt finds there; nothing on a
 * via or off the copper.
 */
export function segmentUnder(shapes: CopperShapes, p: Point, scale: number, visible: LayerVisibility, context: PickContext): TrackSegment | undefined {
  const hit = copperAt(shapes, p, scale, visible, context)
  const track = hit?.kind === "track" ? shapes.tracks.find((one) => one.id === hit.id) : undefined
  const index = track && segmentAt(track.points, p, copperReach(track.width, scale))
  return track && index !== undefined ? { id: track.id, index } : undefined
}

/**
 * What a press at `p` grabs of a track with `points`: a corner handle when the track is selected alone (`sole`; its
 * two ends have none, they stay on their pads), else the segment under the press, else nothing.
 */
export function copperGrip(points: readonly Point[], p: Point, scale: number, sole: boolean, width = 0): CopperGrip | undefined {
  const corner = sole ? cornerAt(points, p, handleReach(scale)) : undefined
  if (corner !== undefined) return { kind: "corner", index: corner }
  const index = segmentAt(points, p, copperReach(width, scale))
  return index === undefined ? undefined : { kind: "segment", index }
}

/** A shown track or via with the box its copper covers, for a selection box. */
export type CopperArea = CopperHit & { box: Box }

const padded = (points: readonly Point[], half: number): Box => {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const r = (value: number) => roundPosition(value)
  return { minX: r(Math.min(...xs) - half), minY: r(Math.min(...ys) - half), maxX: r(Math.max(...xs) + half), maxY: r(Math.max(...ys) + half) }
}

/** The box of each shown track (its points widened by half its width) and via (its ring), tracks first, in file order. */
export function copperBoxes(shapes: CopperShapes, visible: LayerVisibility): CopperArea[] {
  const tracks = shapes.tracks.filter((track) => copperShown({ kind: "track", layer: track.layer, ...stray(track) }, visible))
  const vias = shapes.vias.filter((via) => copperShown({ kind: "via", ...stray(via) }, visible))
  return [
    ...tracks.map((track): CopperArea => ({ kind: "track", id: track.id, box: padded(track.points, track.width / 2) })),
    ...vias.map((via): CopperArea => ({ kind: "via", id: via.id, box: padded([via.at], via.diameter / 2) })),
  ]
}

/** The copper a selection box from `a` to `b` takes by the direction rule (box-select.ts), in order. */
export function copperInBox(areas: readonly CopperArea[], a: Point, b: Point, mode: BoxMode): CopperHit[] {
  const taken = new Set(areasInBox(areas, a, b, mode))
  return areas.filter((area) => taken.has(area.id)).map(({ kind, id }) => ({ kind, id }))
}
