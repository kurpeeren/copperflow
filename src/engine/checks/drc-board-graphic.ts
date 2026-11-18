// The board's drawings on the silkscreen (`<boardgraphic layer="top-silkscreen|bottom-silkscreen">`) against what the
// board house clips silkscreen off or cannot print: an exposed pad, a drill or a hole under the ink is `silk-on-pad`,
// ink past the board outline is `silk-off-board`, and lines thinner than a board house prints are `silk-too-thin`.
// They judge the very areas and lines the Gerber legend carries (graphic-place.ts, fab/graphic-objects.ts). A drawing
// on the mask is an opening, not ink, and is not checked here. Pure.
import { isCopperGraphic } from "../board-graphic.js"
import { usableOutline } from "../board.js"
import { graphicBox, MIN_GRAPHIC_LINE_WIDTH } from "../graphic-place.js"
import type { BoardGraphic, Point } from "../model.js"
import type { PcbLayout } from "../pcb.js"
import type { Rules } from "../rules/schema.js"
import { obstaclesFor, type Obstacle } from "./drc-silk-text.js"
import { bounds, pointInPolygon, shapeToSegmentDistance } from "./geometry.js"
import { breaksMinimum, LENGTH_TOLERANCE } from "./limits.js"
import { violation, type Violation } from "./violation.js"

const mm = (value: number) => value.toFixed(3)
const named = (graphic: BoardGraphic) => `${graphic.id} (${graphic.file})`
const sideOf = (graphic: BoardGraphic): "top" | "bottom" => (graphic.layer.startsWith("bottom") ? "bottom" : "top")
const isSilk = (graphic: BoardGraphic) => graphic.layer.endsWith("silkscreen")

type Segment = [Point, Point, number]

/** Every edge of the drawing's ink with half its width: the areas' outlines (no width) and the lines. */
function inkSegments(graphic: BoardGraphic): Segment[] {
  const ring = (points: readonly Point[]): Segment[] => points.map((p, i) => [p, points[(i + 1) % points.length] as Point, 0])
  const line = (points: readonly Point[], half: number): Segment[] =>
    points.length === 1 ? [[points[0] as Point, points[0] as Point, half]] : points.slice(1).map((p, i) => [points[i] as Point, p, half])
  return [...graphic.areas.flatMap((area) => [...ring(area.outer), ...area.holes.flatMap(ring)]), ...graphic.lines.flatMap((one) => line(one.points, one.width / 2))]
}

/** Whether the point lies in one of the drawing's filled areas (not in a hole of it). */
const inArea = (graphic: BoardGraphic, p: Point) => graphic.areas.some((area) => pointInPolygon(p, area.outer) && !area.holes.some((hole) => pointInPolygon(p, hole)))

/** The nearest the drawing's ink comes to the obstacle, in mm: below zero when it lies on it. */
function inkDistance(graphic: BoardGraphic, segments: readonly Segment[], obstacle: Obstacle): number {
  if (obstacle.shape.core.some((p) => inArea(graphic, p))) return -obstacle.shape.radius
  let nearest = Infinity
  for (const [a, b, half] of segments) nearest = Math.min(nearest, shapeToSegmentDistance(obstacle.shape, a, b) - half)
  return nearest
}

function onPads(graphic: BoardGraphic, obstacles: readonly Obstacle[], minimum: number): Violation[] {
  const box = graphicBox(graphic)
  const near = obstacles.filter((obstacle) => {
    const b = bounds(obstacle.shape)
    return b.minX <= box.maxX + minimum && b.maxX >= box.minX - minimum && b.minY <= box.maxY + minimum && b.maxY >= box.minY - minimum
  })
  if (near.length === 0) return []
  const segments = inkSegments(graphic)
  return near.flatMap((obstacle) => {
    const distance = inkDistance(graphic, segments, obstacle)
    if (!breaksMinimum(distance, minimum)) return []
    const how = distance > 0 ? `${mm(distance)} mm from` : "on"
    const message = `Silkscreen drawing ${named(graphic)} is ${how} ${obstacle.id}; the minimum is ${mm(minimum)} mm, and the board house clips the ink there: move or shrink the drawing`
    return [violation("silk-on-pad", "warning", message, [graphic.id, obstacle.id], "pcb", obstacle.at)]
  })
}

function offBoard(graphic: BoardGraphic, outline: readonly Point[]): Violation[] {
  const edges = outline.map((p, i): [Point, Point] => [p, outline[(i + 1) % outline.length] as Point])
  const clear = (p: Point, half: number) => pointInPolygon(p, outline) && edges.every(([a, b]) => shapeToSegmentDistance({ core: [p], radius: 0 }, a, b) >= half - LENGTH_TOLERANCE)
  const inside = graphic.areas.every((area) => area.outer.every((p) => clear(p, 0))) && graphic.lines.every((line) => line.points.every((p) => clear(p, line.width / 2)))
  if (inside) return []
  const message = `Silkscreen drawing ${named(graphic)} runs off the board; the board house clips it at the edge: move it inside the outline or make it smaller`
  return [violation("silk-off-board", "warning", message, [graphic.id], "pcb", { x: graphic.x, y: graphic.y })]
}

function tooThin(graphic: BoardGraphic): Violation[] {
  let thinnest = Infinity
  for (const line of graphic.lines) thinnest = Math.min(thinnest, line.width)
  if (!(thinnest < MIN_GRAPHIC_LINE_WIDTH - LENGTH_TOLERANCE)) return []
  const message = `Silkscreen drawing ${named(graphic)} has lines ${mm(thinnest)} mm wide; the thinnest a board house prints is about ${mm(MIN_GRAPHIC_LINE_WIDTH)} mm: give it a larger width or thicker lines in the file`
  return [violation("silk-too-thin", "warning", message, [graphic.id], "pcb", { x: graphic.x, y: graphic.y })]
}

/**
 * Each drawing on copper whose lines are narrower than the fabrication's minimum track width. Thin parts of a filled
 * shape are not measured (the guide says so); its clearance, edge, keepout and hole checks are the copper checks'.
 */
export function copperGraphicChecks(layout: PcbLayout, rules: Rules): Violation[] {
  const minimum = rules.fabrication.minTrackWidth
  return (layout.graphics ?? []).filter(isCopperGraphic).flatMap((graphic) => {
    let thinnest = Infinity
    for (const line of graphic.lines) thinnest = Math.min(thinnest, line.width)
    if (!(thinnest < minimum - LENGTH_TOLERANCE)) return []
    const message = `Drawing on copper ${named(graphic)} has lines ${mm(thinnest)} mm wide; the fabrication minimum track width is ${mm(minimum)} mm: give it a larger width or thicker lines in the file`
    return [violation("drawing-width", "warning", message, [graphic.id], "pcb", { x: graphic.x, y: graphic.y })]
  })
}

/** Every silkscreen drawing against the pads and holes under it, the board's outline and the thinnest printable line. */
export function boardGraphicChecks(layout: PcbLayout, rules: Rules): Violation[] {
  const graphics = (layout.graphics ?? []).filter(isSilk)
  if (graphics.length === 0) return []
  const outline = usableOutline(layout.board) ? (layout.board?.outline ?? []) : undefined
  const sides = { top: obstaclesFor(layout, "top"), bottom: obstaclesFor(layout, "bottom") }
  return graphics.flatMap((graphic) => [...onPads(graphic, sides[sideOf(graphic)], rules.fabrication.minSilkToPad), ...(outline ? offBoard(graphic, outline) : []), ...tooThin(graphic)])
}
