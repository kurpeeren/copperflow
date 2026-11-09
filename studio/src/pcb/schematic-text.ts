// The schematic's text pass: every text collected while the symbols, labels and flags were drawn is written upright
// in screen space at a whole number of device pixels, on a device pixel, and only when the sheet's level (judged by
// the designator's size) allows its kind and it is itself at least 5 device pixels (text-level.ts). Pin names of one
// symbol are fitted first, drawn smaller or shortened, so they never print over each other (pin-name-fit.ts).
import { anchorAlignment, canvasFont, CANVAS_MONO_FAMILY, TEXT_WEIGHT, type Ctx } from "./ctx.js"
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"
import { fitPinNames, type PinName } from "./pin-name-fit.js"
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
  /** A pin name: the symbol it belongs to and the centre of that symbol's body on the sheet. */
  pinOf?: { symbol: string; centre: Point }
  /** The widest the text may be on the sheet; a larger text is drawn smaller. */
  maxWidth?: number
}

type Paint = { camera: Camera; size: Size; ratio: number }

/** The gap kept between two pin names, as a share of their font size. */
const NAME_GAP = 0.25
/** How tall a pin name's ink is, as a share of its font size: capitals and digits, which pin names are, reach about 0.75. */
const NAME_INK_HEIGHT = 0.8

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

/** The pin names of one symbol with the text and size each is written with; a name that does not fit is left out. */
function fitSymbol(ctx: Ctx, names: Sized[], paint: Paint): Sized[] {
  const first = names[0]
  if (!first?.label.pinOf) return names
  ctx.font = fontOf(first.label, first.devicePx, paint.ratio)
  const onScreen: PinName[] = names.map(({ label, devicePx }) => {
    const p = worldToScreen(paint.camera, paint.size, label.at)
    const align = anchorAlignment(label.anchor)[1] as PinName["align"]
    return { text: label.text, x: p.x, y: p.y, align, height: (devicePx / paint.ratio) * NAME_INK_HEIGHT }
  })
  const origin = worldToScreen(paint.camera, paint.size, first.label.pinOf.centre)
  const fits = fitPinNames(onScreen, origin, (text) => ctx.measureText(text).width, (first.devicePx / paint.ratio) * NAME_GAP)
  return names.flatMap((sized, i) => {
    const fit = fits[i]
    if (!fit) return []
    const devicePx = fit.scale < 1 ? Math.floor(sized.devicePx * fit.scale) : sized.devicePx
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
