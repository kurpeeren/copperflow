// What an SVG element's attributes say: its paint (inherited down the tree), its basic shape as path data, and the
// root's user unit in mm. Each paint's colour is read as ink or clear (colour.ts); an opacity of 0 draws nothing,
// any other opacity is drawn in full.
import { isZeroOpacity, readColour, type Tone } from "./colour.js"
import { GraphicError } from "./shapes.js"
import { multiply, scaling, translation, type Matrix } from "./transform.js"
import type { XmlElement } from "./xml.js"
import type { FillRule } from "./rings.js"

export interface Paint {
  fill: boolean
  fillRule: FillRule
  stroke: boolean
  /** Whether the fill and the stroke are dark (ink) or light (clear). */
  fillTone: Tone
  strokeTone: Tone
  /** False under an opacity of 0 (it multiplies down the tree, so no child undoes it). */
  opaque: boolean
  /** A fill-opacity or stroke-opacity of 0, inherited until a child gives its own. */
  fillTransparent: boolean
  strokeTransparent: boolean
  /** In user units. */
  strokeWidth: number
  visible: boolean
}

export const DEFAULT_PAINT: Paint = { fill: true, fillRule: "nonzero", stroke: false, fillTone: "ink", strokeTone: "ink", opaque: true, fillTransparent: false, strokeTransparent: false, strokeWidth: 1, visible: true }

export const MM_PER_PX = 25.4 / 96
const MM_PER_UNIT: Record<string, number> = { "": MM_PER_PX, px: MM_PER_PX, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 }

/** The `style` attribute's declarations over the presentation attributes. */
export function propertiesOf(element: XmlElement): Map<string, string> {
  const properties = new Map(element.attributes)
  for (const declaration of (element.attributes.get("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":")
    if (colon > 0) properties.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).replace(/!important/, "").trim())
  }
  return properties
}

/** A finite number, or undefined when absent; a value that is not a finite number is refused. */
export function numberOf(value: string | undefined, what: string): number | undefined {
  if (value === undefined || value.trim() === "" || value.trim().endsWith("%")) return undefined
  const number = Number(value.trim().replace(/px$/, ""))
  if (!Number.isFinite(number)) throw new GraphicError(`The ${what} "${value.slice(0, 40)}" is not a finite number`)
  return number
}

/** One paint property (fill or stroke) given the parent's: whether it paints, its tone, and whether its colour was unread. */
function paintPart(value: string | undefined, painted: boolean, tone: Tone): { painted: boolean; tone: Tone; unread: boolean } {
  if (value === undefined || value === "inherit") return { painted, tone, unread: false }
  if (value.startsWith("url(")) return { painted: true, tone: "ink", unread: false }
  const colour = readColour(value)
  if (colour === "none") return { painted: false, tone, unread: false }
  if (colour === "unread") return { painted: true, tone: "ink", unread: true }
  return { painted: true, tone: colour.tone, unread: false }
}

/** An inherited opacity property of 0: the element's own value when it gives one, else the parent's. */
const transparent = (value: string | undefined, parent: boolean) => (value === undefined || value.trim() === "inherit" ? parent : isZeroOpacity(value))

/**
 * The element's paint, given its parent's; `usesUrl` tells a gradient or pattern paint, drawn as a plain one, and
 * `unread` counts the colours that could not be read (drawn as ink).
 */
export function paintOf(properties: ReadonlyMap<string, string>, parent: Paint): { paint: Paint; usesUrl: boolean; unread: number } {
  const fill = properties.get("fill")?.trim()
  const stroke = properties.get("stroke")?.trim()
  const rule = properties.get("fill-rule")?.trim()
  const visibility = properties.get("visibility")?.trim()
  const width = numberOf(properties.get("stroke-width"), "stroke width")
  const fillPart = paintPart(fill, parent.fill, parent.fillTone)
  const strokePart = paintPart(stroke, parent.stroke, parent.strokeTone)
  const paint: Paint = {
    fill: fillPart.painted,
    fillRule: rule === "evenodd" || rule === "nonzero" ? rule : parent.fillRule,
    stroke: strokePart.painted,
    fillTone: fillPart.tone,
    strokeTone: strokePart.tone,
    opaque: parent.opaque && !isZeroOpacity(properties.get("opacity")),
    fillTransparent: transparent(properties.get("fill-opacity"), parent.fillTransparent),
    strokeTransparent: transparent(properties.get("stroke-opacity"), parent.strokeTransparent),
    strokeWidth: width === undefined ? parent.strokeWidth : Math.abs(width),
    visible: visibility === undefined || visibility === "inherit" ? parent.visible : visibility === "visible",
  }
  return { paint, usesUrl: [fill, stroke].some((v) => v?.startsWith("url(")), unread: Number(fillPart.unread) + Number(strokePart.unread) }
}

const num = (element: XmlElement, name: string) => numberOf(element.attributes.get(name), `attribute ${name}`) ?? 0

function pointsData(element: XmlElement, close: boolean): string | undefined {
  const values = (element.attributes.get("points") ?? "").trim().split(/[\s,]+/).filter((v) => v !== "").map((v) => numberOf(v, "point") ?? 0)
  if (values.length < 4) return undefined
  const pairs = Array.from({ length: Math.floor(values.length / 2) }, (_, i) => `${values[2 * i]} ${values[2 * i + 1]}`)
  return `M${pairs.join(" L")}${close ? " Z" : ""}`
}

function rectData(e: XmlElement): string | undefined {
  const [x, y, w, h] = [num(e, "x"), num(e, "y"), num(e, "width"), num(e, "height")]
  if (w <= 0 || h <= 0) return undefined
  const rxAttr = numberOf(e.attributes.get("rx"), "attribute rx")
  const ryAttr = numberOf(e.attributes.get("ry"), "attribute ry")
  const rx = Math.min(Math.abs(rxAttr ?? ryAttr ?? 0), w / 2)
  const ry = Math.min(Math.abs(ryAttr ?? rxAttr ?? 0), h / 2)
  if (rx === 0 || ry === 0) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`
  const arc = (dx: number, dy: number) => `a${rx} ${ry} 0 0 1 ${dx} ${dy}`
  return `M${x + rx} ${y} H${x + w - rx} ${arc(rx, ry)} V${y + h - ry} ${arc(-rx, ry)} H${x + rx} ${arc(-rx, -ry)} V${y + ry} ${arc(rx, -ry)} Z`
}

function ellipseData(cx: number, cy: number, rx: number, ry: number): string | undefined {
  if (rx <= 0 || ry <= 0) return undefined
  return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
}

/** A basic shape as path data, or undefined when it draws nothing. */
export function shapeData(e: XmlElement): string | undefined {
  switch (e.name) {
    case "path":
      return e.attributes.get("d")
    case "rect":
      return rectData(e)
    case "circle":
      return ellipseData(num(e, "cx"), num(e, "cy"), num(e, "r"), num(e, "r"))
    case "ellipse":
      return ellipseData(num(e, "cx"), num(e, "cy"), num(e, "rx"), num(e, "ry"))
    case "line":
      return `M${num(e, "x1")} ${num(e, "y1")} L${num(e, "x2")} ${num(e, "y2")}`
    case "polyline":
      return pointsData(e, false)
    case "polygon":
      return pointsData(e, true)
    default:
      return undefined
  }
}

/** A physical length in mm ("20mm", "1in", "96" px), or undefined for none or a percentage. */
function lengthMm(value: string | undefined): number | undefined {
  const found = value?.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/)
  if (!found) return undefined
  const mm = Number(found[1]) * (MM_PER_UNIT[found[2] ?? ""] as number)
  return Number.isFinite(mm) && mm > 0 ? mm : undefined
}

/** The root's map from user units to mm, y flipped (y up). */
export function rootMatrix(svg: XmlElement): Matrix {
  const box = (svg.attributes.get("viewBox") ?? "").trim().split(/[\s,]+/).map(Number)
  const [vx, vy, vw, vh] = box as [number, number, number, number]
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || vw <= 0 || vh <= 0) return scaling(MM_PER_PX, -MM_PER_PX)
  const width = lengthMm(svg.attributes.get("width"))
  const height = lengthMm(svg.attributes.get("height"))
  let sx = width === undefined ? undefined : width / vw
  let sy = height === undefined ? undefined : height / vh
  sx ??= sy ?? MM_PER_PX
  sy ??= sx
  if ((svg.attributes.get("preserveAspectRatio") ?? "").trim() !== "none") sx = sy = Math.min(sx, sy)
  return multiply(scaling(sx, -sy), translation(-vx, -vy))
}
