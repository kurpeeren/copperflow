import { padShape, type Shape } from "../checks/geometry.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { Point, PourLayer } from "../model.js"
import { naturalCompare } from "../order.js"
import type { WorldPad } from "../pcb.js"
import { boundsOf, boxesMeet, boxHolds, intersection, regionHolds, toPath, type Bounds, type IntPoint, type Path, type Region } from "./clip.js"
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

/** An item ready to test: its points and outlines in clipper units and the box round its outlines, built once. */
interface Prepared {
  id: string
  points: IntPoint[]
  outlines: Path[]
  box: Bounds | undefined
}

function prepared(item: Item): Prepared {
  const outlines = item.shapes.map((shape) => toPath(shapeOutline(shape, TOUCH))).filter((path) => path.length >= 3)
  return { id: item.id, points: toPath(item.points), outlines, box: outlines.length === 0 ? undefined : boundsOf(outlines) }
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

function touches(piece: Piece, item: Prepared): boolean {
  if (item.box === undefined || !boxesMeet(piece.box, item.box)) return item.points.some((p) => holds(piece, p))
  if (item.points.some((p) => holds(piece, p))) return true
  return intersection([piece.region.outer, ...piece.region.holes], item.outlines).length > 0
}

/** The connections the pours make per net (`PcbLayout.pourMade`). */
export type PourMade = readonly { net: string; count: number }[]

/**
 * "3 connections on GND are made by pours" (or, with `more`, "3 more on GND are made by pours"): the total and the nets
 * (three at most are named), as the sentence the check and the router both use. Undefined when the pours make none.
 */
export function pourMadeText(made: PourMade, more = false): string | undefined {
  const total = made.reduce((sum, one) => sum + one.count, 0)
  if (total === 0) return undefined
  const nets = [...new Set(made.map((one) => one.net.replace(/^net[.:]/, "")))].sort(naturalCompare)
  const named = `${nets.slice(0, 3).join(", ")}${nets.length > 3 ? ` and ${nets.length - 3} more` : ""}`
  const what = more ? `${total} more` : total === 1 ? "1 connection" : `${total} connections`
  return `${what} on ${named} ${total === 1 ? "is" : "are"} made by pours`
}

/**
 * For each piece of each fill (pours in order, pieces in order), the ids of its net's copper it touches, in pad, track
 * and via order. A piece touching nothing gives an empty list.
 */
export function pourJoins(fills: readonly PourFill[], pads: readonly WorldPad[], tracks: readonly PcbTrack[], vias: readonly PcbVia[]): string[][] {
  return fills.flatMap((fill) => {
    const items = itemsOf(fill, pads, tracks, vias).map(prepared)
    return fill.polygons.map((polygon) => {
      const region: Region = { outer: toPath(polygon.outer), holes: polygon.holes.map(toPath) }
      const piece: Piece = { region, box: boundsOf([region.outer]) }
      return items.filter((item) => touches(piece, item)).map((item) => item.id)
    })
  })
}
