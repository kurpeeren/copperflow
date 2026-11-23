// Aligning a reference image on the PCB canvas, as plain functions: where the image lies while points are picked, the
// board point a click means (the nearest hole or pad centre when one is close), and the hint over the canvas. Plain
// TypeScript with .js imports, so the tests can run it.
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import { fitReference, invertMatrix, mapPoint, type BoardFrame, type FitPoint, type Matrix3 } from "../../../src/engine/reference-fit.js"
import type { PcbLayout } from "../../../src/engine/pcb.js"
import type { Aligning } from "./reference-store.js"
import type { Ctx } from "./ctx.js"

/** How near a hole or pad centre a click must be to land on it, in screen pixels. */
const SNAP_PIXELS = 14

/** Where the image lies: as written; after one new pair, moved so that pair meets; after two or more, fitted to them. */
export function aligningMatrix(record: ReferenceRecord, aligning: Aligning | null, board: BoardFrame | undefined): Matrix3 {
  const before = fitReference(record, board).matrix
  if (!aligning || aligning.id !== record.id || aligning.points.length === 0) return before
  if (aligning.points.length >= 2) return fitReference({ ...record, points: aligning.points }, board).matrix
  const [first] = aligning.points as [{ image: FitPoint; board: FitPoint }]
  const at = mapPoint(before, first.image)
  const [dx, dy] = [first.board.x - at.x, first.board.y - at.y]
  const m = before
  return [m[0] + dx * m[6], m[1] + dx * m[7], m[2] + dx * m[8], m[3] + dy * m[6], m[4] + dy * m[7], m[5] + dy * m[8], m[6], m[7], m[8]]
}

/** The image pixel under a board point; undefined when the image is folded flat. */
export function imagePixelAt(matrix: Matrix3, world: FitPoint): FitPoint | undefined {
  const back = invertMatrix(matrix)
  return back && mapPoint(back, world)
}

/** The nearest hole, drill or pad centre within SNAP_PIXELS of the click, else the click itself. */
export function snapToBoard(world: FitPoint, pcb: Pick<PcbLayout, "parts" | "holes">, scale: number): FitPoint {
  const reach = SNAP_PIXELS / scale
  let best: FitPoint | undefined
  let bestDistance = reach
  const consider = (p: FitPoint) => {
    const d = Math.hypot(p.x - world.x, p.y - world.y)
    if (d <= bestDistance) [best, bestDistance] = [{ x: p.x, y: p.y }, d]
  }
  for (const hole of pcb.holes ?? []) consider(hole)
  for (const part of pcb.parts) for (const pad of part.pads) consider(pad)
  return best ?? world
}

/** What the canvas says while aligning. */
export function alignHint(aligning: Aligning): string {
  const pair = aligning.points.length + 1
  if (aligning.picked) return `Point ${pair}: now click where it belongs on the board (a hole or pad centre snaps). Esc ends.`
  const more = aligning.points.length >= 4 ? "Add more, or press Esc to end." : aligning.points.length >= 2 ? "Two points scale and turn it; four take out a photo's slant. Esc ends." : "Click a point on the picture, such as a mounting hole."
  return `Align the reference image: point ${pair}. ${more}`
}

/** The board points picked in this run and the pixel waiting for its pair, where they lie now, to mark them. */
export function alignMarks(matrix: Matrix3, aligning: Aligning | null): { placed: FitPoint[]; picked?: FitPoint } {
  if (!aligning) return { placed: [] }
  return { placed: aligning.points.map((p) => p.board), ...(aligning.picked ? { picked: mapPoint(matrix, aligning.picked) } : {}) }
}

/** The marks' colour: cyan, apart from every layer colour. */
const MARK_COLOUR = "#00e5ff"
const MARK_RADIUS = 6

/** Rings on the board points picked in this run and a cross on the pixel waiting for its pair, in screen pixels. */
export function drawAlignMarks(ctx: Pick<Ctx, "save" | "restore" | "beginPath" | "arc" | "moveTo" | "lineTo" | "stroke" | "strokeStyle" | "lineWidth">, marks: { placed: FitPoint[]; picked?: FitPoint }, toScreen: (p: FitPoint) => FitPoint): void {
  ctx.save()
  ctx.strokeStyle = MARK_COLOUR
  ctx.lineWidth = 2
  for (const p of marks.placed.map(toScreen)) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, MARK_RADIUS, 0, 2 * Math.PI)
    ctx.stroke()
  }
  if (marks.picked) {
    const p = toScreen(marks.picked)
    ctx.beginPath()
    ctx.moveTo(p.x - MARK_RADIUS * 1.5, p.y)
    ctx.lineTo(p.x + MARK_RADIUS * 1.5, p.y)
    ctx.moveTo(p.x, p.y - MARK_RADIUS * 1.5)
    ctx.lineTo(p.x, p.y + MARK_RADIUS * 1.5)
    ctx.stroke()
  }
  ctx.restore()
}
