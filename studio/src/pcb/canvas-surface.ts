// The canvas surface between paints. Setting a canvas's width or height clears and reallocates its backing store, so
// it is set only when the CSS size or the device pixel ratio changes; each paint resets the context state instead.
import type { Size } from "./geometry.js"

export interface BackingStore {
  width: number
  height: number
}

/** The backing store a CSS size needs at a device pixel ratio, in whole device pixels. */
export function backingSize(size: Size, ratio: number): BackingStore {
  return { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) }
}

/** Resizes the canvas's backing store only when it differs from what the size and ratio need; true when it did. */
export function fitBackingStore(canvas: BackingStore, size: Size, ratio: number): boolean {
  const wanted = backingSize(size, ratio)
  if (canvas.width === wanted.width && canvas.height === wanted.height) return false
  canvas.width = wanted.width
  canvas.height = wanted.height
  return true
}

/** The context state a paint must not inherit from the last one; `reset` is missing in older browsers. */
export interface ResettableContext {
  reset?: () => void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  setLineDash(segments: number[]): void
  globalAlpha: number
  globalCompositeOperation: string
}

/** Puts the context back to its defaults, as resizing the canvas did on every paint before. */
export function resetContext(ctx: ResettableContext): void {
  if (typeof ctx.reset === "function") {
    ctx.reset()
    return
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
  ctx.setLineDash([])
}
