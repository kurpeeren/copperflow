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

/** One ring per violation: red for errors, amber for warnings, thicker for the active one. Expects a CSS-pixel transform. */
export function drawViolationMarkers(ctx: Ctx, view: { camera: Camera; size: Size }, markers: readonly ViolationMarker[], active: string | undefined): void {
  if (markers.length === 0) return
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  for (const marker of markers) {
    const p = worldToScreen(view.camera, view.size, marker.at)
    ctx.strokeStyle = marker.severity === "error" ? PALETTE.error : PALETTE.warning
    ctx.lineWidth = marker.id === active ? ACTIVE_WIDTH_PX : RING_WIDTH_PX
    ctx.beginPath()
    ctx.arc(p.x, p.y, RING_PX, 0, Math.PI * 2)
    ctx.stroke()
  }
}
