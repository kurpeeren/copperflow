// An SVG drawing as plain shapes. Reads svg, g, a, switch, path, rect, circle, ellipse, line, polyline, polygon and
// `use` of a local "#id" (one level: a `use` inside what a `use` draws is left out). defs, symbol and the like are
// drawn only through a `use`; a symbol's own viewBox is not applied, nor a nested svg's. Nothing is fetched: an href
// to a file or a URL is counted and left alone. Text, images, style sheets, clipping and masking are left out and
// counted. Dark paint is ink and light paint is clear, applied in the file's order (paint-order.ts).
import type { Point } from "../model.js"
import { applyInOrder, type PaintedItem } from "./paint-order.js"
import { parsePathData } from "./path-data.js"
import { fillsFromRings } from "./rings.js"
import { counted, CURVE_TOLERANCE_MM, finish, GraphicError, type GraphicShapes } from "./shapes.js"
import { DEFAULT_PAINT, numberOf, paintOf, propertiesOf, rootMatrix, shapeData, type Paint } from "./svg-attributes.js"
import { apply, maxScale, meanScale, multiply, parseTransform, translation, type Matrix } from "./transform.js"
import { parseXml, type XmlElement } from "./xml.js"

/** The largest SVG text read, in characters. */
export const MAX_SVG_TEXT = 2 * 1024 * 1024

const GROUPS = new Set(["svg", "g", "a", "switch"])
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"])
/** Containers whose content is drawn only by reference, or never. */
const NOT_DRAWN = new Set(["defs", "symbol", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "marker", "filter", "metadata", "title", "desc", "script"])

/** Each note's singular and plural, keyed by what was left out. */
const NOTES = {
  text: ["text element", "text elements"],
  image: ["embedded image", "embedded images"],
  style: ["style sheet not applied", "style sheets not applied"],
  clip: ["shape drawn unclipped (its clip-path or mask is not applied)", "shapes drawn unclipped (their clip-path or mask is not applied)"],
  url: ["gradient or pattern paint drawn as a plain fill", "gradient or pattern paints drawn as a plain fill"],
  link: ["link to another file not followed", "links to other files not followed"],
  nestedUse: ["use inside a used element left out (use is followed one level)", "uses inside used elements left out (use is followed one level)"],
  missingUse: ["use of an id the file does not have", "uses of ids the file does not have"],
  broken: ["path with bad data drawn up to the error", "paths with bad data drawn up to the error"],
  foreign: ["foreign object", "foreign objects"],
  paint: ["paint not read, drawn as ink", "paints not read, drawn as ink"],
} as const

type Note = keyof typeof NOTES

interface Context {
  matrix: Matrix
  paint: Paint
  inUse: boolean
}

interface Collected {
  /** Each element's fill and stroke, in the file's order. */
  items: PaintedItem[]
  notes: Map<Note, number>
  ids: ReadonlyMap<string, XmlElement>
  points: number
}

const note = (out: Collected, key: Note): void => void out.notes.set(key, (out.notes.get(key) ?? 0) + 1)

function idsOf(root: XmlElement): Map<string, XmlElement> {
  const ids = new Map<string, XmlElement>()
  const walk = (e: XmlElement): void => {
    const id = e.attributes.get("id")
    if (id !== undefined && !ids.has(id)) ids.set(id, e)
    e.children.forEach(walk)
  }
  walk(root)
  return ids
}

function drawShape(element: XmlElement, data: string, ctx: Context, out: Collected): void {
  const scale = maxScale(ctx.matrix)
  if (!Number.isFinite(scale)) throw new GraphicError("A transform makes the drawing infinitely large")
  if (scale === 0) return
  const path = parsePathData(data, CURVE_TOLERANCE_MM / scale, out.points)
  if (path.broken) note(out, "broken")
  const subpaths = path.subpaths.map((s) => ({ closed: s.closed, points: s.points.map((p): Point => apply(ctx.matrix, p)) }))
  out.points += subpaths.reduce((sum, s) => sum + s.points.length, 0)
  if (ctx.paint.fill && !ctx.paint.fillTransparent && element.name !== "line") out.items.push({ tone: ctx.paint.fillTone, fills: fillsFromRings(subpaths.map((s) => s.points), ctx.paint.fillRule), strokes: [] })
  if (ctx.paint.stroke && !ctx.paint.strokeTransparent) {
    const width = ctx.paint.strokeWidth * meanScale(ctx.matrix)
    out.items.push({ tone: ctx.paint.strokeTone, fills: [], strokes: subpaths.map((s) => ({ points: s.points, width, closed: s.closed })) })
  }
}

function drawUse(element: XmlElement, ctx: Context, out: Collected): void {
  const href = (element.attributes.get("href") ?? element.attributes.get("xlink:href") ?? "").trim()
  if (!href.startsWith("#")) return href === "" ? undefined : note(out, "link")
  if (ctx.inUse) return note(out, "nestedUse")
  const target = out.ids.get(href.slice(1))
  if (!target) return note(out, "missingUse")
  const x = numberOf(element.attributes.get("x"), "use x") ?? 0
  const y = numberOf(element.attributes.get("y"), "use y") ?? 0
  const inner: Context = { ...ctx, matrix: multiply(ctx.matrix, translation(x, y)), inUse: true }
  if (target.name === "symbol") target.children.forEach((child) => visit(child, inner, out))
  else visit(target, inner, out)
}

const COUNTED: Partial<Record<string, Note>> = { text: "text", image: "image", style: "style", foreignObject: "foreign" }

/** Counts the elements that are left out; true when the element is not drawn. */
function leftOut(element: XmlElement, out: Collected): boolean {
  const key = COUNTED[element.name]
  if (key) note(out, key)
  return key !== undefined || NOT_DRAWN.has(element.name) || !(GROUPS.has(element.name) || SHAPES.has(element.name) || element.name === "use")
}

function visit(element: XmlElement, parent: Context, out: Collected): void {
  if (leftOut(element, out)) return
  const properties = propertiesOf(element)
  if (properties.get("display")?.trim() === "none") return
  const { paint, usesUrl, unread } = paintOf(properties, parent.paint)
  for (let i = 0; i < unread; i++) note(out, "paint")
  const transform = element.attributes.get("transform")
  const ctx: Context = { ...parent, paint, matrix: transform === undefined ? parent.matrix : multiply(parent.matrix, parseTransform(transform)) }
  if (properties.has("clip-path") || properties.has("mask")) note(out, "clip")
  if (element.name === "use") return drawUse(element, ctx, out)
  if (GROUPS.has(element.name)) return element.children.forEach((child) => visit(child, ctx, out))
  const data = shapeData(element)
  if (data === undefined || !paint.visible || !paint.opaque || (!paint.fill && !paint.stroke)) return
  if (usesUrl) note(out, "url")
  drawShape(element, data, ctx, out)
}

const notesOf = (notes: ReadonlyMap<Note, number>): string[] => [...notes].map(([key, count]) => counted(count, NOTES[key][0], NOTES[key][1]))

/** How the drawing is read: `colour: false` reads every painted shape as ink, in place (as for a board's outline). */
export interface SvgReadOptions {
  colour?: boolean
}

function svgRoot(text: string): XmlElement {
  if (text.length > MAX_SVG_TEXT) throw new GraphicError("The SVG file is larger than 2 MB; simplify it first")
  const root = parseXml(text)
  if (root.name !== "svg") throw new GraphicError(`The file's root element is <${root.name}>, not <svg>`)
  return root
}

const PHYSICAL_LENGTH = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*(?:mm|cm|in|pt|pc)\s*$/

/** Whether the root's width and height are both given in a physical unit (mm, cm, in, pt or pc; not px). */
export function svgHasPhysicalSize(text: string): boolean {
  const root = svgRoot(text)
  return [root.attributes.get("width"), root.attributes.get("height")].every((value) => value !== undefined && PHYSICAL_LENGTH.test(value))
}

/** Reads an SVG file's text; throws a GraphicError saying what is wrong with it. */
export function readSvgGraphic(text: string, options: SvgReadOptions = {}): GraphicShapes {
  const root = svgRoot(text)
  const out: Collected = { items: [], notes: new Map(), ids: idsOf(root), points: 0 }
  // The root's own position and transform do not place it; its paint is inherited like a group's.
  const { paint, unread } = paintOf(propertiesOf(root), DEFAULT_PAINT)
  for (let i = 0; i < unread; i++) note(out, "paint")
  const ctx: Context = { matrix: rootMatrix(root), paint, inUse: false }
  root.children.forEach((child) => visit(child, ctx, out))
  const items = options.colour === false ? out.items.map((item) => ({ ...item, tone: "ink" as const })) : out.items
  const { fills, strokes, notes } = applyInOrder(items)
  return finish(fills, strokes, [...notesOf(out.notes), ...notes])
}
