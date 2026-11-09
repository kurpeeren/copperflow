// Pin names inside a symbol never print over each other. Each name gets a room: a left- or right-running name its
// share of the row up to the name facing it across the body, a centred (top or bottom) name its pitch band between its
// neighbours. A name wider than its room is first drawn smaller, down to 70% of the pin-name size, then shortened with
// an ellipsis at that size, and only dropped when fewer than two characters fit. Two names whose boxes still overlap
// are both left out. All in CSS pixels on screen.
import type { Point } from "./geometry.js"

/** A pin name on screen: its anchor, which way it runs from the anchor, and the height of its ink at full size. */
export interface PinName {
  text: string
  x: number
  y: number
  align: "left" | "right" | "center"
  height: number
}

/** The text a name is drawn with and its size as a share of the pin-name size (1, or down to MIN_NAME_SCALE). */
export interface FittedName {
  text: string
  scale: number
}

type Measure = (text: string) => number

/** The smallest a pin name is drawn, as a share of the pin-name size, before it is shortened. */
export const MIN_NAME_SCALE = 0.7
const ELLIPSIS = "…"
const MIN_CHARACTERS = 2

/** The text if it fits in `maxWidth`, else its longest start of at least two characters with an ellipsis that does, else null. */
export function fitText(text: string, maxWidth: number, measure: Measure): string | null {
  if (measure(text) <= maxWidth) return text
  for (let keep = text.length - 1; keep >= MIN_CHARACTERS; keep--) {
    const short = text.slice(0, keep) + ELLIPSIS
    if (measure(short) <= maxWidth) return short
  }
  return null
}

/** The name at full size if it fits, else smaller (not under MIN_NAME_SCALE), else shortened at that size, else null. */
export function fitName(text: string, maxWidth: number, measure: Measure): FittedName | null {
  const width = measure(text)
  if (width <= maxWidth) return { text, scale: 1 }
  if (width * MIN_NAME_SCALE <= maxWidth) return { text, scale: maxWidth / width }
  const short = fitText(text, maxWidth, (t) => measure(t) * MIN_NAME_SCALE)
  return short === null ? null : { text: short, scale: MIN_NAME_SCALE }
}

/** How wide each of two facing names may be in `room`: both as they are when they fit, else the short one keeps its width. */
function allot(room: number, mine: number, theirs: number): number {
  if (mine + theirs <= room) return mine
  const half = room / 2
  if (mine <= half) return mine
  return theirs <= half ? room - theirs : half
}

const rowsOverlap = (a: PinName, b: PinName) => Math.abs(a.y - b.y) < (a.height + b.height) / 2

/** Which side of the body a name is on: left- and right-running names by their run, centred ones above or below the origin. */
const sideOf = (name: PinName, origin: Point) => (name.align === "center" ? (name.y < origin.y ? "top" : "bottom") : name.align)

/** The nearest name across from `name` on its row, or a name of no width at its mirror through the origin. */
function facing(name: PinName, names: readonly PinName[], origin: Point): { x: number; text: string } {
  const toward = name.align === "left" ? 1 : -1
  const across = names.filter((other) => other.align !== name.align && other.align !== "center" && rowsOverlap(name, other) && (other.x - name.x) * toward > 0)
  const nearest = across.sort((a, b) => Math.abs(a.x - name.x) - Math.abs(b.x - name.x))[0]
  return nearest ?? { x: 2 * origin.x - name.x, text: "" }
}

/** A centred name's band: the distance to its nearest neighbour on its side, less the gap; unlimited without one. */
function band(name: PinName, names: readonly PinName[], origin: Point, gap: number): number {
  const pitches = names.filter((other) => other !== name && sideOf(other, origin) === sideOf(name, origin)).map((other) => Math.abs(other.x - name.x))
  return pitches.length === 0 ? Infinity : Math.min(...pitches) - gap
}

/** The widest the name may be drawn. */
function roomFor(name: PinName, names: readonly PinName[], origin: Point, measure: Measure, gap: number): number {
  if (name.align === "center") return band(name, names, origin, gap)
  const other = facing(name, names, origin)
  const room = Math.abs(other.x - name.x) - gap
  return allot(room, measure(name.text), other.text === "" ? 0 : measure(other.text))
}

interface Span {
  x0: number
  x1: number
  y0: number
  y1: number
}

function spanOf(name: PinName, width: number, height: number): Span {
  const x0 = name.align === "left" ? name.x : name.align === "right" ? name.x - width : name.x - width / 2
  return { x0, x1: x0 + width, y0: name.y - height / 2, y1: name.y + height / 2 }
}

const overlap = (a: Span, b: Span) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** The indices of names whose boxes overlap another's among those `pair` allows; both of each pair are dropped. */
function overlapping(spans: readonly (Span | null)[], pair: (i: number, j: number) => boolean): Set<number> {
  const dropped = new Set<number>()
  spans.forEach((a, i) => {
    spans.forEach((b, j) => {
      if (j > i && a && b && pair(i, j) && overlap(a, b)) dropped.add(i).add(j)
    })
  })
  return dropped
}

/**
 * How each pin name of one symbol is drawn, or null where it is left out. `origin` is the body's centre on screen;
 * `gap` is the least room kept between two names. Neighbours on one side that still overlap go first; a name that
 * still overlaps another (a side name against a top or bottom one) goes with it.
 */
export function fitPinNames(names: readonly PinName[], origin: Point, measure: Measure, gap: number): (FittedName | null)[] {
  const fitted = names.map((name) => fitName(name.text, roomFor(name, names, origin, measure, gap), measure))
  const spans = fitted.map((fit, i) => (fit === null ? null : spanOf(names[i] as PinName, measure(fit.text) * fit.scale, (names[i] as PinName).height * fit.scale)))
  const sides = names.map((name) => sideOf(name, origin))
  const sameSide = overlapping(spans, (i, j) => sides[i] === sides[j])
  const left = spans.map((span, i) => (sameSide.has(i) ? null : span))
  const crossing = overlapping(left, () => true)
  return fitted.map((fit, i) => (sameSide.has(i) || crossing.has(i) ? null : fit))
}
