// The board's copper pours and holes as the PCB canvas sees them: which are shown, their outlines, their names, and what
// lies under the pointer (a pour's outline edge or corner, a hole, a fill). A pour is picked by its outline, not by its
// fill, so a press on the board inside a pour still reaches the parts and the empty board under it. Plain TypeScript
// with .js imports, so the tests run it without a DOM. Only types come from the engine.
import type { Design } from "../../../src/engine/design.js"
import type { CopperPour, Hole, Point } from "../../../src/engine/model.js"
import type { PourFill } from "../../../src/engine/pcb.js"
import type { LayerVisibility } from "./layers.js"
import { distanceToSegment, WIRE_REACH_PX } from "./wire-hit.js"

/** How near (CSS pixels) a corner handle of the selected pour's outline takes a press. */
export const POUR_CORNER_PX = 7

/** What these functions read of the built design. */
export type PourDesign = Pick<Design, "circuit"> & { pcb: Pick<Design["pcb"], "board" | "pours" | "holes"> }

/** The pours the design writes (the intent, with its outline), in source order. */
export const poursOf = (design: PourDesign): readonly CopperPour[] => design.pcb.board?.pours ?? []

/** The outline a pour fills: its own, or the board's for a whole-board pour. */
export function pourOutline(pour: Pick<CopperPour, "outline">, board: PourDesign["pcb"]["board"]): readonly Point[] {
  return pour.outline ?? board?.outline ?? []
}

/** A net's first name, by its id; the id when the circuit does not list it. */
export function pourNetName(design: Pick<Design, "circuit">, net: string): string {
  return design.circuit.nets.find((one) => one.id === net)?.names[0] ?? net
}

/** "pour GND · bottom", as the hover label names it. */
export const pourLabel = (design: Pick<Design, "circuit">, pour: Pick<CopperPour, "net" | "layer">): string => `pour ${pourNetName(design, pour.net)} · ${pour.layer}`

/** A length in mm as it is written, without float noise. */
const mmText = (value: number): string => `${Number(value.toFixed(4))} mm`

/** "hole 3.2 mm". */
export const holeLabel = (hole: Pick<Hole, "diameter">): string => `hole ${mmText(hole.diameter)}`

/**
 * Whether a pour (by its layer and id) is drawn and picked: the Layer panel's eye for it open, and for a top or bottom
 * pour its copper layer shown too. An inner layer has no row of its own yet, so its pours follow their own eyes alone.
 */
export function pourShown(pour: { id: string; layer: string }, visible: LayerVisibility, hidden: ReadonlySet<string>): boolean {
  if (hidden.has(pour.id)) return false
  return pour.layer === "top" || pour.layer === "bottom" ? visible[pour.layer] : pour.layer === "inner1" || pour.layer === "inner2"
}

/** The ring of points closed back to its first, as edges. */
function edges(ring: readonly Point[]): Array<[Point, Point]> {
  return ring.map((a, i) => [a, ring[(i + 1) % ring.length] as Point])
}

/** The shown pour whose outline passes within reach of `world`, the nearest; undefined when none does. */
export function pourEdgeAt(design: PourDesign, world: Point, scale: number, visible: LayerVisibility, hidden: ReadonlySet<string>): string | undefined {
  const reach = WIRE_REACH_PX / scale
  let best: { id: string; distance: number } | undefined
  for (const pour of poursOf(design)) {
    if (!pourShown(pour, visible, hidden)) continue
    for (const [a, b] of edges(pourOutline(pour, design.pcb.board))) {
      const distance = distanceToSegment(world, a, b)
      if (distance <= reach && (!best || distance < best.distance)) best = { id: pour.id, distance }
    }
  }
  return best?.id
}

/** The index of the outline's corner within reach of `world`, if any. */
export function pourCornerAt(outline: readonly Point[], world: Point, scale: number): number | undefined {
  const reach = POUR_CORNER_PX / scale
  const index = outline.findIndex((corner) => Math.hypot(corner.x - world.x, corner.y - world.y) <= reach)
  return index === -1 ? undefined : index
}

/** The hole under `world` (inside it, or within a few pixels of its edge), while the Hole layer is shown. */
export function holeAt(holes: readonly Hole[], world: Point, scale: number, visible: LayerVisibility): string | undefined {
  if (!visible.hole) return undefined
  const reach = WIRE_REACH_PX / 2 / scale
  return holes.find((hole) => Math.hypot(hole.x - world.x, hole.y - world.y) <= hole.diameter / 2 + reach)?.id
}

/** Whether a point is inside a ring (even-odd). */
export function insideRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false
  for (const [a, b] of edges(ring)) {
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Whether a point is on a fill's copper: inside one of its pieces and in none of that piece's holes. */
export function onFill(fill: Pick<PourFill, "polygons">, p: Point): boolean {
  return fill.polygons.some((polygon) => insideRing(p, polygon.outer) && !polygon.holes.some((hole) => insideRing(p, hole)))
}

/** The shown pour whose fill covers `world`, the last drawn (the active layer's) first; for the hover label. */
export function pourFillAt(design: PourDesign, world: Point, visible: LayerVisibility, hidden: ReadonlySet<string>, activeLayer?: string): string | undefined {
  const shown = design.pcb.pours.filter((fill) => pourShown(fill, visible, hidden))
  const ordered = [...shown.filter((fill) => fill.layer === activeLayer), ...shown.filter((fill) => fill.layer !== activeLayer)]
  return ordered.find((fill) => onFill(fill, world))?.id
}

/** The middle of a pour's outline's bounds, or a hole's centre: where a check about it is ringed and the camera goes. */
export function boardItemCentre(design: PourDesign, id: string): Point | undefined {
  const hole = design.pcb.holes.find((one) => one.id === id)
  if (hole) return { x: hole.x, y: hole.y }
  const pour = poursOf(design).find((one) => one.id === id)
  const outline = pour ? pourOutline(pour, design.pcb.board) : []
  if (outline.length === 0) return undefined
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/** Whether an id names a pour or a hole. */
export const isBoardItemId = (id: string): boolean => /^(copperpour|hole):\d+$/.test(id)
