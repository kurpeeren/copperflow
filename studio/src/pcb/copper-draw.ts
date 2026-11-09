// The PCB's copper from the layout file, drawn in world units under drawPcb's transform: tracks as round-capped,
// round-joined strokes in their layer's colour (the inactive copper layer first and dimmed to 40%, as EasyEDA does),
// then vias as a ring in the plated colour with a dark hole, then the track tool's copper (the route being drawn, and
// those waiting for their build at 70%), then the hover outline and the selection (a white outline and the 50% white
// wash). The Layer panel's rows decide what shows (copper-hit.ts copperShown).
import type { PcbTrack, PcbVia } from "../../../src/engine/pcb.js"
import { PALETTE, PCB_DIM, type Ctx } from "./ctx.js"
import { copperShown } from "./copper-hit.js"
import type { Point } from "./geometry.js"
import type { LayerVisibility } from "./layers.js"
import type { RouteDrawing } from "./track-tool.js"

/** The copper layer not being worked on is drawn at this alpha. */
export const INACTIVE_COPPER_ALPHA = 0.4
/** A track sent and waiting for its build is drawn solid at this alpha, as EasyEDA draws a track just placed. */
export const PENDING_ROUTE_ALPHA = 0.7
/** How far the selection and hover outlines reach past the copper's edge, in CSS pixels. */
const OUTLINE_PX = 1.5

export type CopperTrackDraw = Pick<PcbTrack, "id" | "net" | "layer" | "width" | "points">
export type CopperViaDraw = Pick<PcbVia, "id" | "net" | "at" | "drill" | "diameter">

export interface CopperScene {
  tracks: readonly CopperTrackDraw[]
  vias: readonly CopperViaDraw[]
  /** The copper layer being worked on, drawn last and at full alpha; top by default. */
  activeLayer?: "top" | "bottom"
  /** The selected tracks and vias, by id. */
  selected: ReadonlySet<string>
  /** The track or via under the pointer. */
  hover?: string
  /** The track tool's copper: the route being drawn (alpha 1) and those waiting for their build (PENDING_ROUTE_ALPHA). */
  routes?: readonly { drawing: RouteDrawing; alpha: number }[]
}

type Highlight = { nets: readonly string[] } | undefined

const LAYER_COLORS: Record<PcbTrack["layer"], string> = { top: PALETTE.topCopper, bottom: PALETTE.bottomCopper, inner1: PALETTE.topCopper, inner2: PALETTE.topCopper }

/** The alpha for copper on `net`: dimmed when a highlight leaves it out. */
const litAlpha = (highlight: Highlight, net: string | undefined): number => (highlight && (net === undefined || !highlight.nets.includes(net)) ? PCB_DIM : 1)

function strokePath(ctx: Ctx, points: readonly Point[], color: string, width: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

function disc(ctx: Ctx, at: Point, radius: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(at.x, at.y, Math.max(radius, 0), 0, Math.PI * 2)
  ctx.fill()
}

function drawTracks(ctx: Ctx, scene: CopperScene, layers: LayerVisibility, highlight: Highlight): void {
  const active = scene.activeLayer ?? "top"
  const shown = scene.tracks.filter((track) => copperShown({ kind: "track", layer: track.layer }, layers))
  const ordered = [...shown.filter((track) => track.layer !== active), ...shown.filter((track) => track.layer === active)]
  for (const track of ordered) {
    ctx.globalAlpha = (track.layer === active ? 1 : INACTIVE_COPPER_ALPHA) * litAlpha(highlight, track.net)
    strokePath(ctx, track.points, LAYER_COLORS[track.layer], track.width)
  }
  ctx.globalAlpha = 1
}

function drawVias(ctx: Ctx, scene: CopperScene, layers: LayerVisibility, highlight: Highlight): void {
  if (!copperShown({ kind: "via" }, layers)) return
  for (const via of scene.vias) {
    ctx.globalAlpha = litAlpha(highlight, via.net)
    disc(ctx, via.at, via.diameter / 2, PALETTE.viaRing)
    if (layers.hole) disc(ctx, via.at, via.drill / 2, PALETTE.drill)
  }
  ctx.globalAlpha = 1
}

/** The track tool's copper, over the rest, on shown layers only. */
function drawRoutes(ctx: Ctx, scene: CopperScene, layers: LayerVisibility): void {
  for (const { drawing, alpha } of scene.routes ?? []) {
    ctx.globalAlpha = alpha
    for (const track of drawing.tracks) if (copperShown({ kind: "track", layer: track.layer }, layers)) strokePath(ctx, track.points, LAYER_COLORS[track.layer], track.width)
    if (!copperShown({ kind: "via" }, layers)) continue
    for (const via of drawing.vias) {
      disc(ctx, via.at, via.diameter / 2, PALETTE.viaRing)
      if (layers.hole) disc(ctx, via.at, via.drill / 2, PALETTE.drill)
    }
  }
  ctx.globalAlpha = 1
}

/** An outline of the track or via `id` in `color`, and with `wash` the 50% white over it; `px` is one CSS pixel in mm. */
function mark(ctx: Ctx, scene: CopperScene, layers: LayerVisibility, id: string, color: string, wash: boolean, px: number): void {
  const track = scene.tracks.find((one) => one.id === id)
  if (track && copperShown({ kind: "track", layer: track.layer }, layers)) {
    strokePath(ctx, track.points, color, track.width + 2 * OUTLINE_PX * px)
    strokePath(ctx, track.points, LAYER_COLORS[track.layer], track.width)
    if (wash) strokePath(ctx, track.points, PALETTE.selectionFill, track.width)
    return
  }
  const via = scene.vias.find((one) => one.id === id)
  if (!via || !copperShown({ kind: "via" }, layers)) return
  disc(ctx, via.at, via.diameter / 2 + OUTLINE_PX * px, color)
  disc(ctx, via.at, via.diameter / 2, PALETTE.viaRing)
  if (wash) disc(ctx, via.at, via.diameter / 2, PALETTE.selectionFill)
  if (layers.hole) disc(ctx, via.at, via.drill / 2, PALETTE.drill)
}

/** Draws the copper and its hover and selection marks; `px` is one CSS pixel in world units. */
export function drawCopperItems(ctx: Ctx, scene: CopperScene, layers: LayerVisibility, highlight: Highlight, px: number): void {
  drawTracks(ctx, scene, layers, highlight)
  drawVias(ctx, scene, layers, highlight)
  drawRoutes(ctx, scene, layers)
  if (scene.hover !== undefined && !scene.selected.has(scene.hover)) mark(ctx, scene, layers, scene.hover, PALETTE.hover, false, px)
  for (const id of scene.selected) mark(ctx, scene, layers, id, PALETTE.selection, true, px)
}
