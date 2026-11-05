// Pure geometry for the PCB and schematic canvases: camera, grid, snapping, bounds and wire paths.
// World units are millimetres (sheet units on the schematic) with y pointing up; screen units are
// CSS pixels with y pointing down.

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The world point at the centre of the view and the zoom in CSS pixels per millimetre. */
export interface Camera {
  cx: number
  cy: number
  scale: number
}

export interface PartBox {
  name: string
  pcbComponentId: string
  center: Point
  box: Box
}

const MIN_SCALE = 0.5
const MAX_SCALE = 2000
const GRID_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100]
const MIN_GRID_PX = 8

export function worldToScreen(camera: Camera, size: Size, p: Point): Point {
  return { x: (p.x - camera.cx) * camera.scale + size.width / 2, y: -(p.y - camera.cy) * camera.scale + size.height / 2 }
}

export function screenToWorld(camera: Camera, size: Size, p: Point): Point {
  return { x: (p.x - size.width / 2) / camera.scale + camera.cx, y: -(p.y - size.height / 2) / camera.scale + camera.cy }
}

/** A camera that shows the whole box with a margin around it. */
export function fitCamera(box: Box, size: Size, margin = 0.12): Camera {
  const width = Math.max(box.maxX - box.minX, 1)
  const height = Math.max(box.maxY - box.minY, 1)
  const scale = Math.min(size.width / width, size.height / height) * (1 - 2 * margin)
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale: clampScale(scale) }
}

/** Zooms by `factor`, keeping the world point under `cursor` where it is on screen. */
export function zoomAt(camera: Camera, size: Size, cursor: Point, factor: number): Camera {
  const anchor = screenToWorld(camera, size, cursor)
  const scale = clampScale(camera.scale * factor)
  return {
    scale,
    cx: anchor.x - (cursor.x - size.width / 2) / scale,
    cy: anchor.y + (cursor.y - size.height / 2) / scale,
  }
}

/** Minor and major grid spacing in millimetres, so minor lines stay at least 8 px apart. */
export function gridSteps(scale: number): { minor: number; major: number } {
  const minor = GRID_STEPS.find((step) => step * scale >= MIN_GRID_PX) ?? (GRID_STEPS[GRID_STEPS.length - 1] as number)
  const index = GRID_STEPS.indexOf(minor)
  const major = GRID_STEPS.slice(index + 1).find((step) => step / minor >= 4) ?? minor * 10
  return { minor, major }
}

/** Rounds to the nearest multiple of `step`, without floating-point noise such as 0.30000000000000004. */
export function snap(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
  return Number((Math.round(value / step) * step).toFixed(decimals))
}

/** The smallest part box that contains the point. */
export function hitTest(boxes: PartBox[], p: Point): PartBox | undefined {
  const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY)
  return boxes
    .filter(({ box }) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY)
    .sort((a, b) => area(a.box) - area(b.box))[0]
}

/** The smallest box around the points, or undefined when there are none. */
export function pointBounds(points: readonly Point[]): Box | undefined {
  if (points.length === 0) return undefined
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** The smallest box around all the boxes, or undefined when there are none. */
export function unionBoxes(boxes: readonly Box[]): Box | undefined {
  return pointBounds(boxes.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]))
}

/** A wire through the points that turns at right angles, going horizontally first; repeated points are dropped. */
export function rightAngles(points: readonly Point[]): Point[] {
  const path: Point[] = []
  for (const p of points) {
    const last = path[path.length - 1]
    if (last && last.x !== p.x && last.y !== p.y) path.push({ x: p.x, y: last.y })
    if (!last || last.x !== p.x || last.y !== p.y) path.push(p)
  }
  return path
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}
