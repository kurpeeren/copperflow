// Where Shift+F10 or the menu key opens the context menu, which a right click opens at the pointer: on the selected
// wire, at the middle of its middle segment; on selected copper (alone), at a track's middle or a via's centre; on the primary selected part, at the centre of its box; or on the empty
// canvas at its centre. Plain TypeScript with .js imports, so the tests can run it.
import { worldToScreen, type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import type { ContextTarget } from "./press.js"
import type { WireLine } from "./wire-hit.js"

/** The canvas element's box on the screen, in client pixels, as getBoundingClientRect gives it. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The middle of a wire's middle segment, where the keyboard opens its menu. */
function wireMiddle(points: readonly Point[]): Point | undefined {
  const index = Math.max(0, Math.floor((points.length - 2) / 2))
  const [a, b] = [points[index], points[index + 1]]
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined
}

/** Selected copper the menu opens on: a track's points, or a via's centre as its one point. */
export interface CopperLine {
  id: string
  points: readonly Point[]
}

/** The copper the keyboard's menu opens on: the first selected track or via, when copper is all that is selected. */
export function selectedCopperLine(
  copper: readonly string[],
  total: number,
  shapes: { tracks: readonly { id: string; points: readonly Point[] }[]; vias: readonly { id: string; at: Point }[] },
): CopperLine | undefined {
  const id = copper[0]
  if (id === undefined || total !== copper.length) return undefined
  const track = shapes.tracks.find((one) => one.id === id)
  if (track) return { id, points: track.points }
  const via = shapes.vias.find((one) => one.id === id)
  return via && { id, points: [via.at] }
}

/** The middle of a track's middle segment, or a via's centre. */
const copperMiddle = (copper: CopperLine): Point | undefined => (copper.points.length === 1 ? copper.points[0] : wireMiddle(copper.points))

/** What the menu opens on, and the sheet point it opens at; undefined for the empty canvas. */
function keyTarget(primary: string | undefined, boxes: readonly PartBox[], wire: WireLine | undefined, copper: CopperLine | undefined): { target: ContextTarget; middle: Point } | undefined {
  const onWire = wire && wireMiddle(wire.points)
  if (wire && onWire) return { target: { kind: "wire", id: wire.id }, middle: onWire }
  const onCopper = copper && copperMiddle(copper)
  if (copper && onCopper) return { target: { kind: "copper", id: copper.id }, middle: onCopper }
  const part = primary === undefined ? undefined : boxes.find((candidate) => candidate.name === primary)
  return part && { target: { kind: "part", name: part.name }, middle: { x: (part.box.minX + part.box.maxX) / 2, y: (part.box.minY + part.box.maxY) / 2 } }
}

/** The target and the point (client pixels, inside the canvas) for a context menu opened from the keyboard. */
export function keyMenuPlace(
  primary: string | undefined,
  boxes: readonly PartBox[],
  camera: Camera | undefined,
  size: Size,
  rect: ScreenRect,
  wire?: WireLine,
  copper?: CopperLine,
): { target: ContextTarget; at: Point } {
  const found = camera ? keyTarget(primary, boxes, wire, copper) : undefined
  const local = found && camera ? worldToScreen(camera, size, found.middle) : { x: size.width / 2, y: size.height / 2 }
  // The element can be drawn scaled (browser zoom), so its CSS pixels are scaled to the rectangle on the screen.
  const scaleX = size.width > 0 ? rect.width / size.width : 1
  const scaleY = size.height > 0 ? rect.height / size.height : 1
  const at = { x: rect.left + clamp(local.x, 0, size.width) * scaleX, y: rect.top + clamp(local.y, 0, size.height) * scaleY }
  return { target: found?.target ?? { kind: "canvas" }, at }
}
