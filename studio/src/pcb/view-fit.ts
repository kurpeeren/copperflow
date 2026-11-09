// What View → Fit selection and Fit area do to the camera, as plain maths: the camera that shows a box, the camera
// for the selected parts' boxes as the open view draws them, and the camera for a box drawn on the canvas.
import { clampScale, unionBoxes, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry.js"

/** The share of the view left empty on each side when the selection is fitted. */
export const FIT_PADDING = 0.1

/** What Fit selection says when none of the selected parts is drawn in the open view. */
export const NOTHING_TO_FIT = "None of the selected parts is in this view."

/** The smallest extent a box is taken to have, so a point or a line still gives a finite zoom. */
const MIN_EXTENT = 1e-6

/** A camera that shows the whole box, centred, with `padding` (a share of the view) kept empty on each side. */
export function fitBoxCamera(box: Box, size: Size, padding: number): Camera {
  const width = Math.max(box.maxX - box.minX, MIN_EXTENT)
  const height = Math.max(box.maxY - box.minY, MIN_EXTENT)
  const scale = Math.min(size.width / width, size.height / height) * (1 - 2 * padding)
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale: clampScale(scale) }
}

/** The camera for the selected parts the view draws, or the reason there is none. */
export function fitSelectionPlan(boxes: readonly PartBox[], names: readonly string[], size: Size, padding: number): { camera: Camera } | { message: string } {
  const chosen = new Set(names)
  const bounds = unionBoxes(boxes.filter((part) => chosen.has(part.name)).map((part) => part.box))
  if (!bounds || size.width <= 0 || size.height <= 0) return { message: NOTHING_TO_FIT }
  return { camera: fitBoxCamera(bounds, size, padding) }
}

/** The camera for a box drawn on the canvas from corner `a` to corner `b` (world units, any two opposite corners): it fills the view. */
export function areaCamera(a: Point, b: Point, size: Size): Camera {
  return fitBoxCamera({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }, size, 0)
}
