// Each fabrication layer drawn by itself into a coverage image, from the very objects its Gerber file is written from
// (gerberLayers) and the drill list the drill files are written from (drillHoles): a flash is its aperture's shape,
// a draw is round-ended lines of its width, a region is its polygon, dark or clear in the file's order; the board's body
// is the area the outline's closed lines enclose, a cut-out inside it left open. Pure.
import type { Point } from "../../model.js"
import type { DrillHole } from "../excellon.js"
import type { Aperture, GerberLayer, GerberObject } from "../gerber.js"
import { box, capsule, disc, emptyCoverage, polygons, toPixel, type Coverage, type Grid, type Paint } from "./raster.js"

/** The angle on the picture of a direction `degrees` counter-clockwise on the board (y up there, down here). */
function pictureAngle(grid: Grid, degrees: number): number {
  const radians = (degrees * Math.PI) / 180
  return Math.atan2(-Math.sin(radians), (grid.mirrored ? -1 : 1) * Math.cos(radians))
}

function flash(layer: Coverage, grid: Grid, at: Point, aperture: Aperture, paint: Paint): void {
  const s = grid.pxPerMm
  const c = toPixel(grid, at)
  switch (aperture.shape) {
    case "circle":
      return disc(layer, c, (aperture.diameter / 2) * s, paint)
    case "rect":
      return box(layer, c, (aperture.width / 2) * s, (aperture.height / 2) * s, 0, 0, paint)
    case "obround": {
      const along = aperture.width >= aperture.height
      const half = (Math.abs(aperture.width - aperture.height) / 2) * s
      const [dx, dy] = along ? [half, 0] : [0, half]
      return capsule(layer, { x: c.x - dx, y: c.y - dy }, { x: c.x + dx, y: c.y + dy }, (Math.min(aperture.width, aperture.height) / 2) * s, paint)
    }
    case "roundrect":
      return box(layer, c, (aperture.width / 2) * s, (aperture.height / 2) * s, pictureAngle(grid, aperture.rotation), aperture.radius * s, paint)
  }
}

function draw(layer: Coverage, grid: Grid, object: GerberObject): void {
  const s = grid.pxPerMm
  if (object.kind === "flash") return flash(layer, grid, object.at, object.aperture, "dark")
  if (object.kind === "region") return polygons(layer, [object.points.map((p) => toPixel(grid, p))], "nonzero", object.polarity === "clear" ? "clear" : "dark")
  const points = object.points.map((p) => toPixel(grid, p))
  const r = (object.width / 2) * s
  if (points.length === 1) return disc(layer, points[0] as Point, r)
  for (let i = 1; i < points.length; i += 1) capsule(layer, points[i - 1] as Point, points[i] as Point, r)
}

/** A layer's objects drawn in order; for the solder mask (a negative layer) that is its openings. */
export function layerImage(grid: Grid, layer: GerberLayer): Coverage {
  const image = emptyCoverage(grid)
  for (const object of layer.objects) draw(image, grid, object)
  return image
}

/** The board's body: the area enclosed by the outline layer's lines, each closed line a boundary (inside a cut-out is out). */
export function bodyImage(grid: Grid, outline: GerberLayer): Coverage {
  const image = emptyCoverage(grid)
  const paths = outline.objects.flatMap((object) => (object.kind === "draw" && object.points.length >= 3 ? [object.points.map((p) => toPixel(grid, p))] : []))
  polygons(image, paths, "evenodd")
  return image
}

/** Drilled holes: a round hole or a slot of the tool's diameter, less `shrink` mm on every side. */
export function holesImage(grid: Grid, holes: readonly DrillHole[], shrink = 0): Coverage {
  const image = emptyCoverage(grid)
  for (const hole of holes) {
    const r = (hole.diameter / 2 - shrink) * grid.pxPerMm
    if (r <= 0) continue
    const from = toPixel(grid, hole.at)
    if (hole.to === undefined) disc(image, from, r)
    else capsule(image, from, toPixel(grid, hole.to), r)
  }
  return image
}
