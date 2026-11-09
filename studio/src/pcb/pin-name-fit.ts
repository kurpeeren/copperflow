// Pin names inside a symbol never print over each other: a name facing another across the body is shortened with an
// ellipsis to its share of the room, or dropped when fewer than two characters fit, and two names whose boxes still
// overlap (neighbours on one side closer than they are wide or tall) are both left out. All in CSS pixels on screen.
import type { Point } from "./geometry.js"

/** A pin name on screen: its anchor, which way it runs from the anchor, and its height (the font size). */
export interface PinName {
  text: string
  x: number
  y: number
  align: "left" | "right" | "center"
  height: number
}

type Measure = (text: string) => number

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

/** How wide each of two facing names may be in `room`: both as they are when they fit, else the short one keeps its width. */
function allot(room: number, mine: number, theirs: number): number {
  if (mine + theirs <= room) return mine
  const half = room / 2
  if (mine <= half) return mine
  return theirs <= half ? room - theirs : half
}

const rowsOverlap = (a: PinName, b: PinName) => Math.abs(a.y - b.y) < (a.height + b.height) / 2

/** The nearest name across from `name` on its row, or a name of no width at its mirror through the origin. */
function facing(name: PinName, names: readonly PinName[], origin: Point): { x: number; text: string } {
  const toward = name.align === "left" ? 1 : -1
  const across = names.filter((other) => other.align !== name.align && other.align !== "center" && rowsOverlap(name, other) && (other.x - name.x) * toward > 0)
  const nearest = across.sort((a, b) => Math.abs(a.x - name.x) - Math.abs(b.x - name.x))[0]
  return nearest ?? { x: 2 * origin.x - name.x, text: "" }
}

/** The name shortened to its share of the room between it and the name across, if any. */
function fitAcross(name: PinName, names: readonly PinName[], origin: Point, measure: Measure, gap: number): string | null {
  if (name.align === "center") return name.text
  const other = facing(name, names, origin)
  const room = Math.abs(other.x - name.x) - gap
  const width = allot(room, measure(name.text), other.text === "" ? 0 : measure(other.text))
  return fitText(name.text, width, measure)
}

interface Span {
  x0: number
  x1: number
  y0: number
  y1: number
}

function spanOf(name: PinName, width: number): Span {
  const x0 = name.align === "left" ? name.x : name.align === "right" ? name.x - width : name.x - width / 2
  return { x0, x1: x0 + width, y0: name.y - name.height / 2, y1: name.y + name.height / 2 }
}

const overlap = (a: Span, b: Span) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * The text each pin name of one symbol is drawn with, or null where it is left out. `origin` is the body's centre on
 * screen; `gap` is the least room kept between two facing names.
 */
export function fitPinNames(names: readonly PinName[], origin: Point, measure: Measure, gap: number): (string | null)[] {
  const fitted = names.map((name) => fitAcross(name, names, origin, measure, gap))
  const spans = fitted.map((text, i) => (text === null ? null : spanOf(names[i] as PinName, measure(text))))
  const dropped = new Set<number>()
  spans.forEach((a, i) => {
    spans.forEach((b, j) => {
      if (j > i && a && b && overlap(a, b)) dropped.add(i).add(j)
    })
  })
  return fitted.map((text, i) => (dropped.has(i) ? null : text))
}
