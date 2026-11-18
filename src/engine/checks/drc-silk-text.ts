// The board's own silkscreen texts (`<silkscreentext>`) against what the board house clips silkscreen off: an exposed
// pad or a hole under the text is `silk-on-pad`, as a part's silkscreen over a pad is; ink that runs off the board
// outline is `silk-off-board`. Both judge the strokes the Gerber legend carries (fab/silk-text-strokes.ts). Pure.
import { usableOutline } from "../board.js"
import { silkTextLineWidth, silkTextStrokes } from "../fab/silk-text-strokes.js"
import type { Hole, Point, SilkText } from "../model.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import type { Rules } from "../rules/schema.js"
import { drillShape, padShape, pointInPolygon, shapeToSegmentDistance, type Shape } from "./geometry.js"
import { breaksMinimum } from "./limits.js"
import { violation, type Violation } from "./violation.js"

const mm = (value: number) => value.toFixed(3)
const quoted = (text: SilkText) => `${text.id} "${text.text.length > 30 ? `${text.text.slice(0, 30)}…` : text.text}"`

/** Something the text must keep off: its name for the message and items, where to point at it, and its shape. */
export interface Obstacle {
  id: string
  at: Point
  shape: Shape
}

/** The pads exposed on the text's side, and every pad's drill and every hole (they go through both sides). */
export function obstaclesFor(layout: PcbLayout, side: SilkText["layer"]): Obstacle[] {
  const pads = layout.parts.flatMap((part) => part.pads)
  const exposed = (pad: WorldPad) => pad.layers === "through" || pad.layers === side
  const padObstacles = pads.flatMap((pad) => {
    const shape = exposed(pad) ? padShape(pad) : drillShape(pad)
    return shape ? [{ id: pad.id, at: { x: pad.x, y: pad.y }, shape }] : []
  })
  const holeObstacles = (layout.holes ?? []).map((hole: Hole) => ({ id: hole.id, at: { x: hole.x, y: hole.y }, shape: { core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 } }))
  return [...padObstacles, ...holeObstacles]
}

const segmentsOf = (lines: readonly Point[][]): [Point, Point][] => lines.flatMap((line) => line.slice(1).map((p, i) => [line[i] as Point, p] as [Point, Point]))

/** The nearest the text's ink comes to the obstacle, in mm: below zero when it lies on it. */
function inkDistance(segments: readonly [Point, Point][], obstacle: Obstacle, half: number): number {
  let nearest = Infinity
  for (const [a, b] of segments) nearest = Math.min(nearest, shapeToSegmentDistance(obstacle.shape, a, b) - half)
  return nearest
}

function onPads(text: SilkText, obstacles: readonly Obstacle[], minimum: number): Violation[] {
  const segments = segmentsOf(silkTextStrokes(text))
  const half = silkTextLineWidth(text.height) / 2
  return obstacles.flatMap((obstacle) => {
    const distance = inkDistance(segments, obstacle, half)
    if (!breaksMinimum(distance, minimum)) return []
    const how = distance > 0 ? `${mm(distance)} mm from` : "on"
    const message = `Silkscreen text ${quoted(text)} is ${how} ${obstacle.id}; the minimum is ${mm(minimum)} mm: move the text`
    return [violation("silk-on-pad", "warning", message, [text.id, obstacle.id], "pcb", obstacle.at)]
  })
}

/** Whether every point of the text's ink, its line's half width included, is inside the outline. */
function inkInside(text: SilkText, outline: readonly Point[]): boolean {
  const half = silkTextLineWidth(text.height) / 2
  const edges = segmentsOf([[...outline, outline[0] as Point]])
  return silkTextStrokes(text)
    .flat()
    .every((p) => pointInPolygon(p, outline) && edges.every(([a, b]) => shapeToSegmentDistance({ core: [p], radius: 0 }, a, b) >= half))
}

function offBoard(text: SilkText, outline: readonly Point[]): Violation[] {
  if (inkInside(text, outline)) return []
  const message = `Silkscreen text ${quoted(text)} runs off the board; the board house clips it at the edge: move it inside the outline or shorten it`
  return [violation("silk-off-board", "warning", message, [text.id], "pcb", { x: text.x, y: text.y })]
}

/** Every board text against the pads and holes under it and the board's outline. */
export function silkTextChecks(layout: PcbLayout, rules: Rules): Violation[] {
  const texts = layout.silkTexts ?? []
  if (texts.length === 0) return []
  const outline = usableOutline(layout.board) ? (layout.board?.outline ?? []) : undefined
  const sides = { top: obstaclesFor(layout, "top"), bottom: obstaclesFor(layout, "bottom") }
  return texts.flatMap((text) => [...onPads(text, sides[text.layer], rules.fabrication.minSilkToPad), ...(outline ? offBoard(text, outline) : [])])
}
