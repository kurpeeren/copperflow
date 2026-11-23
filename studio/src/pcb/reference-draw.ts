// Reference images under the PCB: each image placed by its fit (src/engine/reference-fit.ts) and drawn at its opacity,
// before the copper. A fit with perspective is drawn once into a straight image in board space, triangle by triangle,
// so every redraw after that is one plain transform. Shared by the PCB canvas and the renderer in Node (node-render.ts).
// Plain TypeScript with .js imports, so the tests can run it.
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import { fitReference, isAffine, mapPoint, referenceBox, type BoardFrame, type FitPoint, type Matrix3 } from "../../../src/engine/reference-fit.js"
import type { PcbLayout } from "../../../src/engine/pcb.js"

/** The parts of a 2D context drawing an image needs. */
export interface ImageCtx {
  globalAlpha: number
  imageSmoothingEnabled?: boolean
  save(): void
  restore(): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  clip(): void
  drawImage(image: never, x: number, y: number): void
}

/** Something drawImage takes, with its size. */
export interface Drawable {
  width: number
  height: number
}

/** A canvas to draw a straightened image into: the browser's or @napi-rs/canvas's. */
export type MakeCanvas = (width: number, height: number) => { canvas: Drawable; ctx: ImageCtx }

/** An image ready to draw: a picture and the affine matrix taking its pixels to board mm. */
export interface ReferenceLayer {
  id: string
  image: Drawable
  matrix: Matrix3
  opacity: number
}

/** The largest straightened image, in pixels a side. */
const MAX_SIDE = 4096
/** Pixels of the straightened image per pixel of the photo, along its longer side. */
const OVERSAMPLE = 1.25
/** Cells across and down the photo, each drawn as two triangles. */
const MESH = 16
/** How far each triangle's clip reaches past its edges, in pixels, so no seam shows between them. */
const BLEED = 0.75

/** The board's centre and width from its outline, which place an image that has no points yet. */
export function boardFrameOf(pcb: Pick<PcbLayout, "board">): BoardFrame | undefined {
  const outline = pcb.board?.outline ?? []
  if (outline.length === 0) return undefined
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return { centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, width: maxX - minX }
}

/** The canvas transform taking three source points onto three target points; undefined for a flat triangle. */
function triangleTransform(s: readonly FitPoint[], d: readonly FitPoint[]): [number, number, number, number, number, number] | undefined {
  const [s0, s1, s2] = s as [FitPoint, FitPoint, FitPoint]
  const [d0, d1, d2] = d as [FitPoint, FitPoint, FitPoint]
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y)
  if (Math.abs(det) < 1e-12) return undefined
  const solve = (t0: number, t1: number, t2: number) => {
    const p = ((t1 - t0) * (s2.y - s0.y) - (t2 - t0) * (s1.y - s0.y)) / det
    const q = ((t2 - t0) * (s1.x - s0.x) - (t1 - t0) * (s2.x - s0.x)) / det
    return [p, q, t0 - p * s0.x - q * s0.y] as const
  }
  const [a, c, e] = solve(d0.x, d1.x, d2.x)
  const [b, dd, f] = solve(d0.y, d1.y, d2.y)
  return [a, b, c, dd, e, f]
}

/** The triangle pushed out from its centre by BLEED pixels. */
function bled(points: readonly FitPoint[]): FitPoint[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return points.map((p) => {
    const len = Math.hypot(p.x - cx, p.y - cy) || 1
    return { x: p.x + ((p.x - cx) / len) * BLEED, y: p.y + ((p.y - cy) / len) * BLEED }
  })
}

/** Draws the photo through the perspective into a straight image covering `box`, `k` pixels a mm. */
function straighten(image: Drawable, matrix: Matrix3, make: MakeCanvas): { canvas: Drawable; matrix: Matrix3 } {
  const box = referenceBox(matrix, image.width, image.height)
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY)
  const k = Math.min((Math.max(image.width, image.height) / span) * OVERSAMPLE, MAX_SIDE / span)
  const { canvas, ctx } = make(Math.ceil((box.maxX - box.minX) * k), Math.ceil((box.maxY - box.minY) * k))
  const target = (p: FitPoint) => {
    const at = mapPoint(matrix, p)
    return { x: (at.x - box.minX) * k, y: (box.maxY - at.y) * k }
  }
  const corner = (i: number, j: number) => ({ x: (image.width * i) / MESH, y: (image.height * j) / MESH })
  const triangle = (s: FitPoint[]) => {
    const d = s.map(target)
    const transform = triangleTransform(s, d)
    if (!transform) return
    const edge = bled(d)
    ctx.save()
    ctx.beginPath()
    edge.forEach((p, n) => (n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.clip()
    ctx.setTransform(...transform)
    ctx.drawImage(image as never, 0, 0)
    ctx.restore()
  }
  for (let i = 0; i < MESH; i++)
    for (let j = 0; j < MESH; j++) {
      triangle([corner(i, j), corner(i + 1, j), corner(i + 1, j + 1)])
      triangle([corner(i, j), corner(i + 1, j + 1), corner(i, j + 1)])
    }
  return { canvas, matrix: [1 / k, 0, box.minX, 0, -1 / k, box.maxY, 0, 0, 1] }
}

/** The image ready to draw: itself with its matrix, or straightened first when its fit has perspective. */
export function referenceLayer(record: ReferenceRecord, image: Drawable, board: BoardFrame | undefined, make: MakeCanvas): ReferenceLayer {
  const { matrix } = fitReference(record, board)
  if (isAffine(matrix)) return { id: record.id, image, matrix, opacity: record.opacity }
  const straight = straighten(image, matrix, make)
  return { id: record.id, image: straight.canvas, matrix: straight.matrix, opacity: record.opacity }
}

/** The canvas transform for an image: board mm to device pixels (`world`) after the image's own matrix. */
export function imageTransform(world: readonly [number, number, number, number, number, number], m: Matrix3): [number, number, number, number, number, number] {
  const [wa, wb, wc, wd, we, wf] = world
  return [wa * m[0] + wc * m[3], wb * m[0] + wd * m[3], wa * m[1] + wc * m[4], wb * m[1] + wd * m[4], wa * m[2] + wc * m[5] + we, wb * m[2] + wd * m[5] + wf]
}

/** Draws the layers in order under whatever comes next; `world` takes board mm to device pixels. */
export function drawReferenceLayers(ctx: ImageCtx, layers: readonly ReferenceLayer[], world: readonly [number, number, number, number, number, number]): void {
  for (const layer of layers) {
    if (layer.opacity <= 0) continue
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.imageSmoothingEnabled = true
    ctx.setTransform(...imageTransform(world, layer.matrix))
    ctx.drawImage(layer.image as never, 0, 0)
    ctx.restore()
  }
}
