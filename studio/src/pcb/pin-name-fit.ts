// Pin names inside a symbol never print over each other. Rooms are found in the symbol's own (unturned) frame: a
// side name gets its share of the row up to the name facing it across the body, a top or bottom name its pitch band
// between its neighbours on that side. A name larger than its room is first drawn smaller, down to 70% of the pin-name
// size, then shortened with an ellipsis at that size, and only dropped when fewer than two characters fit. Then two
// names whose ink still overlaps on screen are both left out. All in CSS pixels.
import type { Point } from "./geometry.js"

export type PinSide = "left" | "right" | "top" | "bottom"

/** A pin name: where and how it is written on screen, and where it sits in its symbol's own frame. */
export interface PinName {
  text: string
  /** The anchor on screen and the text's alignment there. */
  x: number
  y: number
  align: "left" | "right" | "center"
  /** The ink above and below the anchor at full size (the font's real metrics for this text). */
  ascent: number
  descent: number
  /** The full font size. */
  size: number
  /** The anchor in the symbol's frame, in CSS px with y up and the body centre at 0, and the body side it is on. */
  local: Point
  side: PinSide
  /** The symbol is turned a quarter: along the frame's x axis the text spans its height, not its width. */
  quarter: boolean
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

/** How far the text reaches along the frame's x axis (the run of a side name, the pitch of a top or bottom one). */
const runOf = (name: PinName, text: string, measure: Measure) => (name.quarter ? name.size : measure(text))
/** How far it reaches along the frame's y axis. */
const acrossOf = (name: PinName, measure: Measure) => (name.quarter ? measure(name.text) : name.size)

const OPPOSITE: Partial<Record<PinSide, PinSide>> = { left: "right", right: "left" }

/** The nearest name across from a side name on its row, or a name of no width at its mirror through the body centre. */
function facing(name: PinName, names: readonly PinName[], measure: Measure): { x: number; run: number } {
  const toward = name.side === "left" ? 1 : -1
  const sameRow = (other: PinName) => Math.abs(other.local.y - name.local.y) < (acrossOf(name, measure) + acrossOf(other, measure)) / 2
  const across = names.filter((other) => other.side === OPPOSITE[name.side] && sameRow(other) && (other.local.x - name.local.x) * toward > 0)
  const nearest = across.sort((a, b) => Math.abs(a.local.x - name.local.x) - Math.abs(b.local.x - name.local.x))[0]
  return nearest ? { x: nearest.local.x, run: runOf(nearest, nearest.text, measure) } : { x: -name.local.x, run: 0 }
}

/** A top or bottom name's band: the distance to its nearest neighbour on its side, less the gap; unlimited without one. */
function band(name: PinName, names: readonly PinName[], gap: number): number {
  const pitches = names.filter((other) => other !== name && other.side === name.side).map((other) => Math.abs(other.local.x - name.local.x))
  return pitches.length === 0 ? Infinity : Math.min(...pitches) - gap
}

/** The most the name may reach along the frame's x axis. */
function roomFor(name: PinName, names: readonly PinName[], measure: Measure, gap: number): number {
  if (name.side === "top" || name.side === "bottom") return band(name, names, gap)
  const other = facing(name, names, measure)
  return allot(Math.abs(other.x - name.local.x) - gap, runOf(name, name.text, measure), other.run)
}

interface Span {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The name's ink on screen, drawn at `scale` of its size. */
function spanOf(name: PinName, fit: FittedName, measure: Measure): Span {
  const width = measure(fit.text) * fit.scale
  const x0 = name.align === "left" ? name.x : name.align === "right" ? name.x - width : name.x - width / 2
  return { x0, x1: x0 + width, y0: name.y - name.ascent * fit.scale, y1: name.y + name.descent * fit.scale }
}

const overlap = (a: Span, b: Span) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** The indices of names whose ink overlaps another's among those `pair` allows; both of each pair are dropped. */
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
 * How each pin name of one symbol is drawn, or null where it is left out; `gap` is the least room kept between two
 * names. Neighbours on one side that still overlap go first; a name that still overlaps another (a side name against
 * a top or bottom one) goes with it.
 */
export function fitPinNames(names: readonly PinName[], measure: Measure, gap: number): (FittedName | null)[] {
  const fitted = names.map((name) => fitName(name.text, roomFor(name, names, measure, gap), (text) => runOf(name, text, measure)))
  const spans = fitted.map((fit, i) => (fit === null ? null : spanOf(names[i] as PinName, fit, measure)))
  const sameSide = overlapping(spans, (i, j) => names[i]?.side === names[j]?.side)
  const left = spans.map((span, i) => (sameSide.has(i) ? null : span))
  const crossing = overlapping(left, () => true)
  return fitted.map((fit, i) => (sameSide.has(i) || crossing.has(i) ? null : fit))
}
