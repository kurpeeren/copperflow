// The schematic's text pass: every text collected while the symbols, labels and flags were drawn is written upright
// in screen space at a whole number of device pixels, on a device pixel, and only when the sheet's level (judged by
// the designator's size) allows its kind and it is itself at least 5 device pixels (text-level.ts). Pin names of one
// symbol are fitted first, drawn smaller or shortened, so they never print over each other (pin-name-fit.ts).
import { anchorAlignment, canvasFont, CANVAS_MONO_FAMILY, TEXT_WEIGHT, type Ctx } from "./ctx.js"
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"
import { fitPinNames, MIN_NAME_SCALE, type PinName, type PinSide } from "./pin-name-fit.js"
import { capToWidth, devicePxFor, sharpenText, sheetLevelPx, textAnchorAt, textShown, type TextKind } from "./text-level.js"

/** One text on the sheet, in sheet units, waiting for the screen pass. */
export interface SheetText {
  text: string
  at: Point
  size: number
  anchor: string
  color: string
  kind: TextKind
  /** The role of a symbol's own text. */
  role?: "reference" | "value" | "pin-name" | "pin-number"
  rotation?: number
  alpha?: number
  /** Designators and net names are bolder than values and pin names. */
  strong?: boolean
  /** Pin numbers are in the mono family. */
  mono?: boolean
  /** A pin name: its symbol, where it sits in the symbol's own frame (sheet units), its side, and whether the symbol is turned a quarter. */
  pinOf?: { symbol: string; local: Point; side: PinSide; quarter: boolean }
  /** The widest the text may be on the sheet; a larger text is drawn smaller. */
  maxWidth?: number
}

type Paint = { camera: Camera; size: Size; ratio: number }

/** The gap kept between two pin names, as a share of their font size. */
const NAME_GAP = 0.25
/** Where a text's ink runs above and below the alphabetic baseline when the browser does not say: 0.8 and 0.2 of its size. */
const FALLBACK_ASCENT = 0.8
const FALLBACK_DESCENT = 0.2
/** How far below the anchor the alphabetic baseline lies for each textBaseline, in sizes, by the fallback metrics. */
const BASELINE_DROP: Record<string, number> = { top: FALLBACK_ASCENT, middle: (FALLBACK_ASCENT - FALLBACK_DESCENT) / 2, bottom: -FALLBACK_DESCENT }

/** A text with its size in device pixels, ready to write. */
interface Sized {
  label: SheetText
  devicePx: number
}

const fontOf = (label: SheetText, devicePx: number, ratio: number) =>
  canvasFont(label.strong ? TEXT_WEIGHT.strong : TEXT_WEIGHT.regular, devicePx / ratio, label.mono ? CANVAS_MONO_FAMILY : undefined)

/** The text's size in whole device pixels, made smaller where it would be wider than its maxWidth. */
function sizeOf(ctx: Ctx, label: SheetText, { camera, ratio }: Paint): number {
  const devicePx = devicePxFor(label.size, camera.scale, ratio)
  if (label.maxWidth === undefined) return devicePx
  ctx.font = fontOf(label, devicePx, ratio)
  return capToWidth(devicePx, ctx.measureText(label.text).width, label.maxWidth * camera.scale)
}

/** The ink above and below the anchor of a text in the current font: the font's own metrics, else the fallback. */
function inkOf(ctx: Ctx, text: string, baseline: string, size: number): { ascent: number; descent: number } {
  ctx.textBaseline = baseline
  const metrics = ctx.measureText(text)
  const drop = (BASELINE_DROP[baseline] ?? 0) * size
  return {
    ascent: metrics.actualBoundingBoxAscent ?? FALLBACK_ASCENT * size - drop,
    descent: metrics.actualBoundingBoxDescent ?? FALLBACK_DESCENT * size + drop,
  }
}

/** A pin name as the fit sees it: on screen with its ink, and in its symbol's own frame. */
function pinName(ctx: Ctx, { label, devicePx }: Sized, paint: Paint): PinName | null {
  const pin = label.pinOf
  if (!pin) return null
  const size = devicePx / paint.ratio
  const p = worldToScreen(paint.camera, paint.size, label.at)
  const [vertical, horizontal] = anchorAlignment(label.anchor)
  const local = { x: pin.local.x * paint.camera.scale, y: pin.local.y * paint.camera.scale }
  const ink = inkOf(ctx, label.text, vertical, size)
  return { text: label.text, x: p.x, y: p.y, align: horizontal as PinName["align"], size, ...ink, local, side: pin.side, quarter: pin.quarter }
}

/** The pin names of one symbol with the text and size each is written with; a name that does not fit is left out. */
function fitSymbol(ctx: Ctx, names: Sized[], paint: Paint): Sized[] {
  const first = names[0]
  if (!first) return names
  ctx.font = fontOf(first.label, first.devicePx, paint.ratio)
  const onScreen = names.map((sized) => pinName(ctx, sized, paint)).filter((name): name is PinName => name !== null)
  if (onScreen.length !== names.length) return names
  // the smallest a name is drawn: the whole device pixel size at or just above 70%, so the fit holds for that size
  const least = Math.ceil(first.devicePx * MIN_NAME_SCALE) / first.devicePx
  const fits = fitPinNames(onScreen, (text) => ctx.measureText(text).width, (first.devicePx / paint.ratio) * NAME_GAP, least)
  return names.flatMap((sized, i) => {
    const fit = fits[i]
    if (!fit) return []
    const devicePx = fit.scale < 1 ? Math.floor(sized.devicePx * fit.scale + 1e-9) : sized.devicePx
    return [{ label: { ...sized.label, text: fit.text }, devicePx }]
  })
}

/** Every text that is drawn, with the pin names fitted symbol by symbol. */
function arrange(ctx: Ctx, labels: readonly SheetText[], paint: Paint): Sized[] {
  const levelPx = sheetLevelPx(paint.camera.scale, paint.ratio)
  const allowed = ({ label, devicePx }: Sized) => textShown(label.kind, levelPx, devicePx)
  const shown = labels
    .filter((label) => label.text !== "")
    .map((label) => ({ label, devicePx: sizeOf(ctx, label, paint) }))
    .filter(allowed)
  const bySymbol = new Map<string, Sized[]>()
  for (const sized of shown) {
    const symbol = sized.label.pinOf?.symbol
    if (symbol !== undefined) bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), sized])
  }
  const fitted = [...bySymbol.values()].flatMap((names) => fitSymbol(ctx, names, paint))
  return [...shown.filter(({ label }) => !label.pinOf), ...fitted.filter(allowed)]
}

function write(ctx: Ctx, { label, devicePx }: Sized, paint: Paint): void {
  const p = textAnchorAt(worldToScreen(paint.camera, paint.size, label.at), paint.ratio)
  const [vertical, horizontal] = anchorAlignment(label.anchor)
  ctx.save()
  ctx.translate(p.x, p.y)
  if (label.rotation) ctx.rotate((-label.rotation * Math.PI) / 180)
  ctx.globalAlpha = label.alpha ?? 1
  ctx.fillStyle = label.color
  ctx.font = fontOf(label, devicePx, paint.ratio)
  ctx.textAlign = horizontal
  ctx.textBaseline = vertical
  ctx.fillText(label.text, 0, 0)
  ctx.restore()
}

/** Writes the texts upright in CSS pixels; the context's transform is the device ratio. */
export function drawSheetTexts(ctx: Ctx, labels: readonly SheetText[], camera: Camera, size: Size, ratio: number): void {
  const paint = { camera, size, ratio }
  sharpenText(ctx)
  for (const sized of arrange(ctx, labels, paint)) write(ctx, sized, paint)
}
