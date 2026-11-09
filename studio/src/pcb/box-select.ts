// The selection box, as EasyEDA draws it: its direction decides what it takes. Dragged left to right (a solid outline)
// it takes the parts wholly inside it; right to left (a dashed outline), every part it touches.
import type { SelectionChange } from "../selection.js"
import { pointBounds, type Box, type PartBox, type Point } from "./geometry.js"

export type BoxMode = "inside" | "touching"

/** Left to right, or straight up or down, takes what is inside; right to left takes what it touches. */
export function boxMode(start: Point, current: Point): BoxMode {
  return current.x >= start.x ? "inside" : "touching"
}

const contains = (outer: Box, inner: Box): boolean => inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY

const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

/** The names of the parts the box from `a` to `b` (world units, any two opposite corners) takes, in the view's order. */
export function partsInBox(boxes: readonly PartBox[], a: Point, b: Point, mode: BoxMode): string[] {
  const area = pointBounds([a, b])
  if (!area) return []
  const takes = mode === "inside" ? (box: Box) => contains(area, box) : (box: Box) => overlaps(area, box)
  return boxes.filter((part) => takes(part.box)).map((part) => part.name)
}

/** The selection after a box: just the parts in it, or, with Shift or Ctrl held, those added to what was selected. */
export function boxSelection(names: readonly string[], adds: boolean): SelectionChange {
  return (current) => (adds ? current.add(names) : current.all(names))
}
