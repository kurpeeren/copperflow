// The selection box, as EasyEDA draws it: its direction decides what it takes. Dragged left to right (a solid outline)
// it takes the parts, wires and net labels wholly inside it; right to left (a dashed outline), every one it touches.
import type { SelectionChange } from "../selection.js"
import { pointBounds, type Box, type PartBox, type Point } from "./geometry.js"
import type { PickLayers } from "./layers.js"
import type { PickFilter } from "./pick-filter.js"
import { pickLabels, pickNames, pickWires } from "./pick.js"
import type { ArmedTool } from "./press.js"
import type { WireLine } from "./wire-hit.js"

export type BoxMode = "inside" | "touching"

/** Left to right, or straight up or down, takes what is inside; right to left takes what it touches. */
export function boxMode(start: Point, current: Point): BoxMode {
  return current.x >= start.x ? "inside" : "touching"
}

const contains = (outer: Box, inner: Box): boolean => inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY

const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

/** The ids of the areas the box from `a` to `b` takes by the direction rule, in their order. */
function areasInBox(areas: readonly { id: string; box: Box }[], a: Point, b: Point, mode: BoxMode): string[] {
  const area = pointBounds([a, b])
  if (!area) return []
  const takes = mode === "inside" ? (box: Box) => contains(area, box) : (box: Box) => overlaps(area, box)
  return areas.filter((one) => takes(one.box)).map((one) => one.id)
}

/** The names of the parts the box from `a` to `b` (world units, any two opposite corners) takes, in the view's order. */
export function partsInBox(boxes: readonly PartBox[], a: Point, b: Point, mode: BoxMode): string[] {
  return areasInBox(boxes.map((part) => ({ id: part.name, box: part.box })), a, b, mode)
}

/** The ids of the net labels and flags the box takes, by what each draws (label-drag.ts labelDrawnBox). */
export function labelsInBox(labels: readonly { id: string; box: Box }[], a: Point, b: Point, mode: BoxMode): string[] {
  return areasInBox(labels, a, b, mode)
}

const inBox = (area: Box, p: Point): boolean => p.x >= area.minX && p.x <= area.maxX && p.y >= area.minY && p.y <= area.maxY

/** Whether the segment from `a` to `b` touches the box: an end inside, or the line through the box between its corners. */
function segmentTouches(area: Box, a: Point, b: Point): boolean {
  if (inBox(area, a) || inBox(area, b)) return true
  const bounds = pointBounds([a, b])
  if (!bounds || !overlaps(area, bounds)) return false
  const corners = [{ x: area.minX, y: area.minY }, { x: area.maxX, y: area.minY }, { x: area.minX, y: area.maxY }, { x: area.maxX, y: area.maxY }]
  const sides = corners.map((c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  return sides.some((side) => side >= 0) && sides.some((side) => side <= 0)
}

/** The ids of the wires the box from `a` to `b` takes, by the parts' rule: every point inside it, or any segment touching it. */
export function wiresInBox(wires: readonly WireLine[], a: Point, b: Point, mode: BoxMode): string[] {
  const area = pointBounds([a, b])
  if (!area) return []
  const takes =
    mode === "inside"
      ? (points: readonly Point[]) => points.every((p) => inBox(area, p))
      : (points: readonly Point[]) => points.some((p, i) => segmentTouches(area, points[i - 1] ?? p, p))
  return wires.filter((wire) => takes(wire.points)).map((wire) => wire.id)
}

/** What a box found: the parts (partsInBox) and, on the schematic, the wires (wiresInBox) and labels (labelsInBox). */
export interface BoxFound {
  parts: readonly string[]
  wires?: readonly string[]
  labels?: readonly string[]
}

/**
 * The selection after a box: just the parts, wires and labels in it that may be picked (pick.ts), or, with Shift or Ctrl held,
 * those added to what was selected. `armed` is the canvas tool armed while the box was drawn, `layers` the PCB's.
 */
export function boxSelection(found: BoxFound, adds: boolean, armed: ArmedTool = null, layers?: PickLayers, filter?: PickFilter): SelectionChange {
  return (current) => {
    const context = { selection: current, armed, layers, filter }
    const [parts, wires, labels] = [pickNames(found.parts, context), pickWires(found.wires ?? [], context), pickLabels(found.labels ?? [], context)]
    return adds ? current.add(parts).addWires(wires).addLabels(labels) : current.all(parts, wires, labels)
  }
}
