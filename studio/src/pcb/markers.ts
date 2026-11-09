// The rings that mark violations on both canvases. They are drawn in screen space, so they keep their size at any zoom.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Severity } from "../../../src/engine/model.js"
import { PALETTE, type Ctx } from "./ctx.js"
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"

/** A violation with a position, as a canvas marks it. */
export interface ViolationMarker {
  id: string
  at: Point
  severity: Severity
}

const RING_PX = 6
const RING_WIDTH_PX = 1.5
const ACTIVE_WIDTH_PX = 3
const HALO_PX = 1

/**
 * One ring per violation: red for errors, amber for warnings, thicker for the active one. `halo` adds a white outer
 * and black inner halo, which the PCB's black ground needs and the light sheet does not. Expects a CSS-pixel transform.
 */
export function drawViolationMarkers(ctx: Ctx, view: { camera: Camera; size: Size }, markers: readonly ViolationMarker[], active: string | undefined, halo: boolean): void {
  if (markers.length === 0) return
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  for (const marker of markers) {
    const p = worldToScreen(view.camera, view.size, marker.at)
    const width = marker.id === active ? ACTIVE_WIDTH_PX : RING_WIDTH_PX
    if (halo) ringHalos(ctx, p, width)
    ctx.strokeStyle = marker.severity === "error" ? PALETTE.error : PALETTE.warning
    ring(ctx, p, RING_PX, width)
  }
}

function ring(ctx: Ctx, p: Point, radius: number, width: number): void {
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.stroke()
}

/** A 1px white ring just outside the marker's ring and a 1px black ring just inside, to separate it from copper and silk. */
function ringHalos(ctx: Ctx, p: Point, width: number): void {
  const edge = (width + HALO_PX) / 2
  ctx.strokeStyle = PALETTE.ringHaloOuter
  ring(ctx, p, RING_PX + edge, HALO_PX)
  ctx.strokeStyle = PALETTE.ringHaloInner
  ring(ctx, p, RING_PX - edge, HALO_PX)
}
