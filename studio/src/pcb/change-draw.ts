// A change drawn over the board: the board dimmed, what was added in cyan with solid lines, what was removed in orange
// with dashed lines (from the design before), each moved part's old outline dotted in white with an arrow to its new
// place, and a small legend. Cyan and orange are told apart by people who do not see red against green, and every mark
// also differs by line style. Used by the PCB view's change view and by the render of a change.
import type { DesignDiff, PartAt } from "../../../src/engine/design-diff.js"
import { canvasFont, PALETTE, TEXT_WEIGHT, type Ctx } from "./ctx.js"
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"

export type ChangeMode = "before" | "after" | "both"

export const CHANGE_LOOK = {
  added: { colour: PALETTE.selectionBox, dash: [] as number[], label: "Added" },
  removed: { colour: PALETTE.warning, dash: [7, 4], label: "Removed" },
  moved: { colour: PALETTE.document, dash: [2, 3], label: "Moved" },
  /** Laid over the board so the marks stand out; the board still reads beneath. */
  dim: "rgb(0 0 0 / 55%)",
  legendPanel: PALETTE.notePanel,
} as const

type View = { camera: Camera; size: Size }
type Mark = (typeof CHANGE_LOOK)["added" | "removed" | "moved"]

const MARK_PX = 3
const ARROW_PX = 10
const VIA_MIN_PX = 4
const LEGEND = { pad: 8, row: 18, sample: 26, font: 12, margin: 10 }

/** Darkens the whole picture, so the marks drawn next stand out. */
export function dimBoard(ctx: Ctx, size: Size): void {
  ctx.save()
  ctx.fillStyle = CHANGE_LOOK.dim
  rectPath(ctx, 0, 0, size.width, size.height)
  ctx.fill()
  ctx.restore()
}

function rectPath(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + width, y)
  ctx.lineTo(x + width, y + height)
  ctx.lineTo(x, y + height)
  ctx.closePath()
}

function stroked(ctx: Ctx, mark: Mark, width: number, draw: () => void): void {
  ctx.save()
  ctx.strokeStyle = mark.colour
  ctx.lineWidth = width
  ctx.lineCap = "butt"
  ctx.lineJoin = "round"
  ctx.setLineDash([...mark.dash])
  ctx.beginPath()
  draw()
  ctx.stroke()
  ctx.restore()
}

function polyline(ctx: Ctx, view: View, points: readonly Point[], closed: boolean): void {
  points.forEach((point, index) => {
    const at = worldToScreen(view.camera, view.size, point)
    if (index === 0) ctx.moveTo(at.x, at.y)
    else ctx.lineTo(at.x, at.y)
  })
  if (closed && points.length > 2) ctx.closePath()
}

/** A part's courtyard, or a small square at its origin when it has none. */
function outlineOf(part: PartAt): Point[] {
  if (part.courtyard.length > 2) return part.courtyard
  const r = 0.5
  return [
    { x: part.x - r, y: part.y - r },
    { x: part.x + r, y: part.y - r },
    { x: part.x + r, y: part.y + r },
    { x: part.x - r, y: part.y + r },
  ]
}

function drawSide(ctx: Ctx, view: View, diff: DesignDiff, side: "added" | "removed"): void {
  const mark = CHANGE_LOOK[side]
  for (const part of diff.parts[side]) stroked(ctx, mark, MARK_PX, () => polyline(ctx, view, outlineOf(part), true))
  for (const track of diff.tracks[side]) stroked(ctx, mark, Math.max(MARK_PX, track.width * view.camera.scale), () => polyline(ctx, view, track.points, false))
  for (const via of diff.vias[side]) {
    const at = worldToScreen(view.camera, view.size, via.at)
    stroked(ctx, mark, MARK_PX, () => ctx.arc(at.x, at.y, Math.max(VIA_MIN_PX, (via.diameter / 2) * view.camera.scale), 0, Math.PI * 2))
  }
  for (const pour of diff.pours[side]) if (pour.outline) stroked(ctx, mark, MARK_PX, () => polyline(ctx, view, pour.outline as Point[], true))
  for (const hole of diff.board.holes[side]) {
    const at = worldToScreen(view.camera, view.size, hole)
    stroked(ctx, mark, MARK_PX, () => ctx.arc(at.x, at.y, Math.max(VIA_MIN_PX, (hole.diameter / 2) * view.camera.scale), 0, Math.PI * 2))
  }
}

/** A line from `from` to `to` with a filled head at `to`, in screen pixels. */
function arrow(ctx: Ctx, from: Point, to: Point, colour: string): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const back = (turn: number) => ({ x: to.x - ARROW_PX * Math.cos(angle + turn), y: to.y - ARROW_PX * Math.sin(angle + turn) })
  ctx.save()
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = MARK_PX - 1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  const [left, right] = [back(0.45), back(-0.45)]
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(left.x, left.y)
  ctx.lineTo(right.x, right.y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawMoves(ctx: Ctx, view: View, diff: DesignDiff, mode: ChangeMode): void {
  const mark = CHANGE_LOOK.moved
  for (const move of diff.parts.moved) {
    stroked(ctx, mark, MARK_PX, () => polyline(ctx, view, outlineOf(move.from), true))
    if (mode === "before") continue
    const from = worldToScreen(view.camera, view.size, move.from)
    const to = worldToScreen(view.camera, view.size, move.to)
    if (Math.hypot(to.x - from.x, to.y - from.y) > ARROW_PX) arrow(ctx, from, to, mark.colour)
  }
}

/** The marks of a change: before shows what was removed and where moved parts were; after what was added and the moves; both all of it. */
export function drawChangeMarks(ctx: Ctx, view: View, diff: DesignDiff, mode: ChangeMode): void {
  if (mode !== "after") drawSide(ctx, view, diff, "removed")
  if (mode !== "before") drawSide(ctx, view, diff, "added")
  drawMoves(ctx, view, diff, mode)
}

/** The legend in the bottom-left corner: a sample of each mark's line and its name. */
export function drawChangeLegend(ctx: Ctx, size: Size, mode: ChangeMode = "both"): void {
  const rows = [CHANGE_LOOK.added, CHANGE_LOOK.removed, CHANGE_LOOK.moved].filter((mark) => mode === "both" || mark !== (mode === "before" ? CHANGE_LOOK.added : CHANGE_LOOK.removed))
  ctx.save()
  ctx.font = canvasFont(TEXT_WEIGHT.regular, LEGEND.font)
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  const textWidth = Math.max(...rows.map((mark) => ctx.measureText(mark.label).width))
  const width = LEGEND.pad * 3 + LEGEND.sample + textWidth
  const height = LEGEND.pad * 2 + LEGEND.row * rows.length
  const left = LEGEND.margin
  const top = size.height - LEGEND.margin - height
  ctx.fillStyle = CHANGE_LOOK.legendPanel
  rectPath(ctx, left, top, width, height)
  ctx.fill()
  rows.forEach((mark, index) => {
    const y = top + LEGEND.pad + LEGEND.row * index + LEGEND.row / 2
    const x = left + LEGEND.pad
    if (mark === CHANGE_LOOK.moved) arrow(ctx, { x, y }, { x: x + LEGEND.sample, y }, mark.colour)
    else stroked(ctx, mark, MARK_PX, () => {
      ctx.moveTo(x, y)
      ctx.lineTo(x + LEGEND.sample, y)
    })
    ctx.fillStyle = mark.colour
    ctx.fillText(mark.label, x + LEGEND.sample + LEGEND.pad, y)
  })
  ctx.restore()
}
