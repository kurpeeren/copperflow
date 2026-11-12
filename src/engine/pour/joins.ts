import { padShape, type Shape } from "../checks/geometry.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { Point, PourLayer } from "../model.js"
import { naturalCompare } from "../order.js"
import type { WorldPad } from "../pcb.js"
import { boundsOf, boxesMeet, boxHolds, intersection, regionHolds, toPath, type Bounds, type IntPoint, type Region } from "./clip.js"
import type { PourFill } from "./fill.js"
import { shapeOutline } from "./shapes.js"

/**
 * Which copper each piece of fill touches: for every pour, piece by piece, the ids of the pads, tracks and vias of the
 * pour's own net on its layer that the piece's copper meets. Only the pour's own net is looked at: the fill keeps clear
 * of every other net by construction, and the copper checks measure that. A piece holding a point of the copper (a pad's
 * or via's centre, a track's points) touches it; otherwise the copper's outline, grown 1 µm so meeting at an edge counts,
 * is intersected with the piece.
 */

/** How far copper is grown to find the pieces it touches, in mm: 1 µm, as for the fill's islands. */
const TOUCH = 0.001

interface Item {
  id: string
  points: Point[]
  shapes: Shape[]
}

interface Piece {
  region: Region
  box: Bounds
}

const padOnLayer = (pad: WorldPad, layer: PourLayer) => pad.layers === "through" || pad.layers === layer

function trackShapes(track: PcbTrack): Shape[] {
  const radius = track.width / 2
  if (track.points.length < 2) return track.points.map((p) => ({ core: [p], radius }))
  return track.points.slice(1).map((p, i) => ({ core: [track.points[i] as Point, p], radius }))
}

/** The pour's own net's copper on its layer, pads first, then tracks and vias, each as test points and outlines. */
function itemsOf(fill: PourFill, pads: readonly WorldPad[], tracks: readonly PcbTrack[], vias: readonly PcbVia[]): Item[] {
  const onBoard = <T extends { missingLayer?: unknown }>(item: T) => item.missingLayer === undefined
  return [
    ...pads
      .filter((pad) => pad.net === fill.net && padOnLayer(pad, fill.layer))
      .flatMap((pad) => {
        const shape = padShape(pad)
        return shape === undefined ? [] : [{ id: pad.id, points: [{ x: pad.x, y: pad.y }], shapes: [shape] }]
      }),
    ...tracks.filter((track) => onBoard(track) && track.net === fill.net && track.layer === fill.layer).map((track) => ({ id: track.id, points: track.points, shapes: trackShapes(track) })),
    ...vias
      .filter((via) => onBoard(via) && via.net === fill.net && viaSpan(via).has(fill.layer))
      .map((via) => ({ id: via.id, points: [via.at], shapes: [{ core: [via.at], radius: via.diameter / 2 }] })),
  ]
}

const holds = (piece: Piece, p: IntPoint): boolean => boxHolds(piece.box, p) && regionHolds(piece.region, p)

function touches(piece: Piece, item: Item): boolean {
  if (toPath(item.points).some((p) => holds(piece, p))) return true
  const outlines = item.shapes.map((shape) => toPath(shapeOutline(shape, TOUCH))).filter((path) => path.length >= 3)
  if (outlines.length === 0 || !boxesMeet(piece.box, boundsOf(outlines))) return false
  return intersection([piece.region.outer, ...piece.region.holes], outlines).length > 0
}

/**
 * The pads the fills connect: pads of a pour's net, on its layer or through, in a piece of fill that also touches some
 * other copper of that net (another pad, a track or a via). A piece that touches one pad alone connects nothing. These
 * are the pads whose connections the ratsnest leaves out because the fill makes them; the same `pourJoins` the layout's
 * copper was resolved with gives them.
 */
export function padsJoinedByPours(layout: { parts: readonly { pads: readonly WorldPad[] }[]; tracks: readonly PcbTrack[]; vias: readonly PcbVia[]; pours: readonly PourFill[] }): WorldPad[] {
  const pads = layout.parts.flatMap((part) => part.pads)
  const byId = new Map(pads.map((pad) => [pad.id, pad]))
  const joined = new Map<string, WorldPad>()
  for (const touched of pourJoins(layout.pours, pads, layout.tracks, layout.vias)) {
    if (touched.length < 2) continue
    for (const id of touched) {
      const pad = byId.get(id)
      if (pad !== undefined) joined.set(id, pad)
    }
  }
  return [...joined.values()]
}

/** "4 pads on GND are joined by pours": the pads the fills connect, by net (three nets at most are named). */
export function joinedByPoursText(pads: readonly WorldPad[]): string {
  const nets = [...new Set(pads.map((pad) => (pad.net ?? "").replace(/^net[.:]/, "")))].sort(naturalCompare)
  const named = nets.slice(0, 3).join(", ")
  const more = nets.length > 3 ? ` and ${nets.length - 3} more` : ""
  return `${pads.length === 1 ? "1 pad" : `${pads.length} pads`} on ${named}${more} ${pads.length === 1 ? "is" : "are"} joined by pours`
}

/**
 * For each piece of each fill (pours in order, pieces in order), the ids of its net's copper it touches, in pad, track
 * and via order. A piece touching nothing gives an empty list.
 */
export function pourJoins(fills: readonly PourFill[], pads: readonly WorldPad[], tracks: readonly PcbTrack[], vias: readonly PcbVia[]): string[][] {
  return fills.flatMap((fill) => {
    const items = itemsOf(fill, pads, tracks, vias)
    return fill.polygons.map((polygon) => {
      const region: Region = { outer: toPath(polygon.outer), holes: polygon.holes.map(toPath) }
      const piece: Piece = { region, box: boundsOf([region.outer]) }
      return items.filter((item) => touches(piece, item)).map((item) => item.id)
    })
  })
}
