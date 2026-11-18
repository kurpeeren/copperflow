// The board's drawings (`<boardgraphic>`, placed by graphic-place.ts) as Gerber objects on one layer: the filled areas
// of every drawing on it united, each piece a dark region and its holes clear regions, largest piece first; then the
// lines as draws of their width. The areas come first in their file so a hole's clear region takes away only the
// drawing's own fill, never anything drawn after it. Pure.
import type { BoardGraphic, BoardGraphicLayer, Point } from "../model.js"
import { pathArea, regions, toPath, toPoints } from "../pour/clip.js"
import type { GerberObject } from "./gerber.js"

const wound = (ring: readonly Point[], counterClockwise: boolean): Point[] => {
  const area = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length] as Point
    return sum + a.x * b.y - b.x * a.y
  }, 0)
  return area > 0 === counterClockwise ? [...ring] : [...ring].reverse()
}

/** The drawings on this layer as Gerber objects: `areas` to come first in the file, `lines` after. */
export function graphicObjects(graphics: readonly BoardGraphic[] | undefined, layer: BoardGraphicLayer, fn?: string): { areas: GerberObject[]; lines: GerberObject[] } {
  const here = (graphics ?? []).filter((graphic) => graphic.layer === layer)
  if (here.length === 0) return { areas: [], lines: [] }
  const extra = fn === undefined ? {} : { function: fn }
  const paths = here.flatMap((graphic) => graphic.areas.flatMap((area) => [toPath(wound(area.outer, true)), ...area.holes.map((hole) => toPath(wound(hole, false)))]))
  const pieces = paths.length === 0 ? [] : regions(paths).sort((a, b) => Math.abs(pathArea(b.outer)) - Math.abs(pathArea(a.outer)))
  const areas = pieces.flatMap((piece): GerberObject[] => [
    { kind: "region", points: toPoints(piece.outer), ...extra },
    ...piece.holes.map((hole): GerberObject => ({ kind: "region", points: toPoints(hole), polarity: "clear" })),
  ])
  const lines = here.flatMap((graphic) => graphic.lines.filter((line) => line.points.length > 0).map((line): GerberObject => ({ kind: "draw", points: line.points, width: line.width, ...extra })))
  return { areas, lines }
}
