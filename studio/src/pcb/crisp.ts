// The one rule for sharp canvas drawing at any display scale. The context draws in CSS pixels, but a device pixel is
// 1 / ratio of one: a hairline is one device pixel wide and sits in the middle of a device pixel, and a small square
// starts on a device pixel edge and is a whole number of device pixels wide.

/** A hairline's width in CSS pixels: one device pixel. */
export const hairlineWidth = (ratio: number): number => 1 / ratio

/** The centre of the device pixel that contains `v` (CSS pixels), where a hairline is drawn. */
export const hairlineAt = (v: number, ratio: number): number => (Math.floor(v * ratio) + 0.5) / ratio

/** Where a small filled square starts: the nearest device pixel edge. */
export const squareAt = (v: number, ratio: number): number => Math.round(v * ratio) / ratio

/** The side of a small square meant to be `css` CSS pixels, in whole device pixels (at least one), as CSS pixels. */
export const squareSide = (css: number, ratio: number): number => Math.max(1, Math.round(css * ratio)) / ratio

/** The device pixel row a text baseline sits on. */
export const baselineAt = (v: number, ratio: number): number => Math.round(v * ratio) / ratio

/** A world-scaled stroke keeps its width but never draws thinner than one device pixel. */
export const atLeastOnePixel = (width: number, ratio: number): number => Math.max(width, 1 / ratio)

/** A stroke of `css` CSS pixels as whole device pixels (at least one). */
export const deviceWidth = (css: number, ratio: number): number => Math.max(1, Math.round(css * ratio))

/** The line position for a stroke `devicePx` device pixels wide: a pixel centre when odd, a pixel edge when even. */
export const edgeAt = (v: number, ratio: number, devicePx: number): number => (devicePx % 2 === 1 ? hairlineAt(v, ratio) : squareAt(v, ratio))

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The rectangle to `strokeRect` for an outline `devicePx` device pixels wide (one by default) between two corners (CSS pixels). */
export function strokeBoxAt(a: { x: number; y: number }, b: { x: number; y: number }, ratio: number, devicePx = 1): Rect {
  const at = (v: number) => edgeAt(v, ratio, devicePx)
  const left = at(Math.min(a.x, b.x))
  const top = at(Math.min(a.y, b.y))
  return { x: left, y: top, width: at(Math.max(a.x, b.x)) - left, height: at(Math.max(a.y, b.y)) - top }
}
