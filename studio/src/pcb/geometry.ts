// Pure geometry for the PCB canvas: camera, grid, snapping and part boxes. World units are
// millimetres with y pointing up; screen units are CSS pixels with y pointing down.

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

export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface PartBox {
  name: string
  pcbComponentId: string
  center: Point
  box: Box
}

interface Element {
  type: string
  [key: string]: unknown
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

/** The world-to-canvas matrix for the drawer; the canvas has `pixelRatio` device pixels per CSS pixel. */
export function toMatrix(camera: Camera, size: Size, pixelRatio: number): Matrix {
  const s = camera.scale * pixelRatio
  return {
    a: s,
    b: 0,
    c: 0,
    d: -s,
    e: (size.width / 2 - camera.cx * camera.scale) * pixelRatio,
    f: (size.height / 2 + camera.cy * camera.scale) * pixelRatio,
  }
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

/** The box of every placed component that has a source name. */
export function componentBoxes(json: Element[]): PartBox[] {
  const names = new Map<unknown, string>()
  for (const e of json) if (e.type === "source_component" && typeof e.name === "string") names.set(e.source_component_id, e.name)
  const boxes: PartBox[] = []
  for (const e of json) {
    if (e.type !== "pcb_component") continue
    const name = names.get(e.source_component_id)
    const center = e.center as Point | undefined
    if (!name || !center || typeof e.width !== "number" || typeof e.height !== "number") continue
    const halfW = e.width / 2
    const halfH = e.height / 2
    boxes.push({
      name,
      pcbComponentId: String(e.pcb_component_id),
      center,
      box: { minX: center.x - halfW, minY: center.y - halfH, maxX: center.x + halfW, maxY: center.y + halfH },
    })
  }
  return boxes
}

/** The smallest part box that contains the point. */
export function hitTest(boxes: PartBox[], p: Point): PartBox | undefined {
  const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY)
  return boxes
    .filter(({ box }) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY)
    .sort((a, b) => area(a.box) - area(b.box))[0]
}

/** The board outline's bounds, or the bounds of all parts when there is no board. */
export function boardBounds(json: Element[]): Box | undefined {
  const board = json.find((e) => e.type === "pcb_board")
  const center = board?.center as Point | undefined
  if (board && center && typeof board.width === "number" && typeof board.height === "number") {
    return { minX: center.x - board.width / 2, minY: center.y - board.height / 2, maxX: center.x + board.width / 2, maxY: center.y + board.height / 2 }
  }
  const boxes = componentBoxes(json).map((b) => b.box)
  if (boxes.length === 0) return undefined
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  }
}

/** Boxes of schematic symbols, from each schematic_component's centre and size. */
export function schematicBoxes(json: Element[]): PartBox[] {
  const names = new Map<unknown, string>()
  for (const e of json) if (e.type === "source_component" && typeof e.name === "string") names.set(e.source_component_id, e.name)
  const boxes: PartBox[] = []
  for (const e of json) {
    if (e.type !== "schematic_component") continue
    const name = names.get(e.source_component_id)
    const center = e.center as Point | undefined
    const size = e.size as { width?: number; height?: number } | undefined
    if (!name || !center || typeof size?.width !== "number" || typeof size.height !== "number") continue
    boxes.push({
      name,
      pcbComponentId: String(e.schematic_component_id),
      center,
      box: { minX: center.x - size.width / 2, minY: center.y - size.height / 2, maxX: center.x + size.width / 2, maxY: center.y + size.height / 2 },
    })
  }
  return boxes
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}
