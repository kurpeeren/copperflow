// Where Shift+F10 or the menu key opens the context menu, which a right click opens at the pointer: on the primary
// selected part, at the centre of its box, or on the empty canvas at its centre. Plain TypeScript with .js imports, so
// the tests can run it.
import { worldToScreen, type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import type { ContextTarget } from "./press.js"

/** The canvas element's box on the screen, in client pixels, as getBoundingClientRect gives it. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The target and the point (client pixels, inside the canvas) for a context menu opened from the keyboard. */
export function keyMenuPlace(primary: string | undefined, boxes: readonly PartBox[], camera: Camera | undefined, size: Size, rect: ScreenRect): { target: ContextTarget; at: Point } {
  const part = primary === undefined || !camera ? undefined : boxes.find((candidate) => candidate.name === primary)
  const middle = part && { x: (part.box.minX + part.box.maxX) / 2, y: (part.box.minY + part.box.maxY) / 2 }
  const local = middle && camera ? worldToScreen(camera, size, middle) : { x: size.width / 2, y: size.height / 2 }
  // The element can be drawn scaled (browser zoom), so its CSS pixels are scaled to the rectangle on the screen.
  const scaleX = size.width > 0 ? rect.width / size.width : 1
  const scaleY = size.height > 0 ? rect.height / size.height : 1
  const at = { x: rect.left + clamp(local.x, 0, size.width) * scaleX, y: rect.top + clamp(local.y, 0, size.height) * scaleY }
  return { target: part ? { kind: "part", name: part.name } : { kind: "canvas" }, at }
}
