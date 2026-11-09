// How canvas text is sized and when it is drawn at all, on both canvases. Text is drawn at a whole number of device
// pixels with its anchor on a device pixel, and small text is left out rather than smeared, as EasyEDA and KiCad do.
import { baselineAt, squareAt } from "./crisp.js"
import type { Point } from "./geometry.js"

/** Below this many device pixels no text is drawn. */
export const TEXT_FROM = 7
/** From this many device pixels every kind of text is drawn; below it only designators and net names. */
export const ALL_TEXT_FROM = 9
/** Pin numbers wait until they are this many device pixels tall. */
export const PIN_NUMBERS_FROM = 11

export type TextLevel = "none" | "names" | "all"

/** What a text is, for the level of detail: designators and net names, pin numbers, and everything else. */
export type TextKind = "name" | "detail" | "pin-number"

/** Which texts a size in device pixels allows: none, designators and net names only, or all. */
export function textLevel(devicePx: number): TextLevel {
  if (devicePx < TEXT_FROM) return "none"
  return devicePx < ALL_TEXT_FROM ? "names" : "all"
}

/** Whether a text of this kind is drawn at this size in device pixels. */
export function textShown(kind: TextKind, devicePx: number): boolean {
  const level = textLevel(devicePx)
  if (kind === "name") return level !== "none"
  if (kind === "pin-number") return devicePx >= PIN_NUMBERS_FROM
  return level === "all"
}

/** A text `worldSize` tall at `scale` CSS pixels per world unit, in whole device pixels (at least one). */
export const devicePxFor = (worldSize: number, scale: number, ratio: number): number => Math.max(1, Math.round(worldSize * scale * ratio))

/** The same size in CSS pixels, for `ctx.font` under the device ratio transform. */
export const fontPxFor = (worldSize: number, scale: number, ratio: number): number => devicePxFor(worldSize, scale, ratio) / ratio

/** A text anchor (CSS pixels) moved onto a device pixel, in x and on its baseline row. */
export const textAnchorAt = (p: Point, ratio: number): Point => ({ x: squareAt(p.x, ratio), y: baselineAt(p.y, ratio) })

/** Asks for geometric text rendering where the browser has the property; older ones and test doubles are left as they are. */
export function sharpenText(ctx: object): void {
  if ("textRendering" in ctx) (ctx as { textRendering: string }).textRendering = "geometricPrecision"
}
