// A perfboard's or stripboard's holes and paths in the PCB view, under the parts: the strips (stripboard) or a pad round
// each hole (perfboard) and the solder runs in the bottom layer's colour, the cuts as crosses, the hole grid, and the
// links in the top layer's colour. The Layer panel's Bottom Layer, Top Layer and Hole switches show and hide them.
import type { CutRecord, LinkRecord, SolderRecord } from "../../../src/core/layout-proto.js"
import { alongStrip, holeKey, holePoint, type ProtoGrid } from "../../../src/engine/proto/grid.js"
import { cutKeys, gridHole, pairKey } from "../../../src/engine/proto/joins.js"
import type { PcbLayout } from "../../../src/engine/pcb.js"
import { PALETTE, type Ctx } from "./ctx.js"
import type { LayerVisibility } from "./layers.js"

const STRIP_WIDTH = 2
const PAD_RADIUS = 0.9
const HOLE_RADIUS = 0.5
const SOLDER_WIDTH = 1.2
const LINK_WIDTH = 0.7
const CUT_REACH = 0.9
const COPPER_ALPHA = 0.35
const SOLDER_ALPHA = 0.85

const dot = (ctx: Ctx, x: number, y: number, r: number) => {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
const line = (ctx: Ctx, a: { x: number; y: number }, b: { x: number; y: number }) => {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

/** The bare copper: strips between their cuts, or a pad round every hole. */
function drawBareCopper(ctx: Ctx, grid: ProtoGrid, cuts: readonly CutRecord[]): void {
  ctx.globalAlpha = COPPER_ALPHA
  ctx.fillStyle = PALETTE.bottomCopper
  ctx.strokeStyle = PALETTE.bottomCopper
  ctx.lineWidth = STRIP_WIDTH
  const cut = cutKeys(grid, cuts)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const hole = { col, row }
      const at = holePoint(grid, hole)
      if (grid.kind === "perfboard") {
        dot(ctx, at.x, at.y, PAD_RADIUS)
        continue
      }
      const next = alongStrip(grid, hole)
      const [a, b] = next ? [holeKey(grid, hole), holeKey(grid, next)] : [0, 0]
      if (next && !cut.at.has(a) && !cut.at.has(b) && !cut.between.has(pairKey(a, b))) line(ctx, at, holePoint(grid, next))
      else if (!cut.at.has(holeKey(grid, hole))) dot(ctx, at.x, at.y, STRIP_WIDTH / 2)
    }
  }
  ctx.globalAlpha = 1
}

function drawSolder(ctx: Ctx, grid: ProtoGrid, runs: readonly SolderRecord[]): void {
  ctx.globalAlpha = SOLDER_ALPHA
  ctx.strokeStyle = PALETTE.bottomCopper
  ctx.lineWidth = SOLDER_WIDTH
  for (const run of runs) {
    const points = run.holes.map((name) => gridHole(grid, name)).map((hole) => (hole ? holePoint(grid, hole) : undefined))
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]]
      if (a && b) line(ctx, a, b)
    }
  }
  ctx.globalAlpha = 1
}

function drawCuts(ctx: Ctx, grid: ProtoGrid, cuts: readonly CutRecord[], hair: number): void {
  ctx.strokeStyle = PALETTE.keepout
  ctx.lineWidth = Math.max(0.2, hair)
  for (const cut of cuts) {
    const holes = (cut.at !== undefined ? [cut.at] : (cut.between ?? [])).map((name) => gridHole(grid, name))
    if (holes.length === 0 || holes.some((hole) => hole === undefined)) continue
    const points = holes.map((hole) => holePoint(grid, hole as NonNullable<typeof hole>))
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length
    line(ctx, { x: x - CUT_REACH, y: y - CUT_REACH }, { x: x + CUT_REACH, y: y + CUT_REACH })
    line(ctx, { x: x - CUT_REACH, y: y + CUT_REACH }, { x: x + CUT_REACH, y: y - CUT_REACH })
  }
}

function drawHoleGrid(ctx: Ctx, grid: ProtoGrid): void {
  ctx.fillStyle = PALETTE.drill
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const at = holePoint(grid, { col, row })
      dot(ctx, at.x, at.y, HOLE_RADIUS)
    }
  }
}

function drawLinks(ctx: Ctx, grid: ProtoGrid, links: readonly LinkRecord[]): void {
  ctx.strokeStyle = PALETTE.topCopper
  ctx.lineWidth = LINK_WIDTH
  for (const link of links) {
    const [from, to] = [gridHole(grid, link.from), gridHole(grid, link.to)]
    if (from && to) line(ctx, holePoint(grid, from), holePoint(grid, to))
  }
}

/** Draws the proto board's layers that are shown; nothing on a made PCB. */
export function drawProto(ctx: Ctx, layout: Pick<PcbLayout, "board" | "proto">, layers: LayerVisibility, hair: number): void {
  const grid = layout.board?.proto
  if (!grid) return
  const records = layout.proto ?? []
  const cuts = records.filter((r): r is CutRecord => r.t === "cut")
  if (layers.bottom) {
    drawBareCopper(ctx, grid, cuts)
    drawSolder(ctx, grid, records.filter((r): r is SolderRecord => r.t === "solder"))
    drawCuts(ctx, grid, cuts, hair)
  }
  if (layers.hole) drawHoleGrid(ctx, grid)
  if (layers.top) drawLinks(ctx, grid, records.filter((r): r is LinkRecord => r.t === "link"))
}
