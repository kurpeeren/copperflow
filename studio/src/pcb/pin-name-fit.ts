// Pin names inside a symbol never print over each other. Rooms are found in the symbol's own (unturned) frame, and
// every name has two: along the line into the body, its share of the room up to the name across (or its mirror
// through the centre), and along its pitch, the band to its nearest neighbour on its side. On screen the name spans
// its width or its height along each, as the symbol is turned. A name larger than its rooms is first drawn smaller,
// down to 70% of the pin-name size, then shortened with an ellipsis at that size, and only dropped when fewer than two
// characters fit. Then two names whose ink still overlaps on screen are both left out. All in CSS pixels.
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

/**
 * The name at full size if `scaleFor` (the largest scale a text may be drawn at) allows it, else smaller (not under
 * `least`), else shortened with an ellipsis at `least`, else null.
 */
function fitScaled(text: string, scaleFor: (text: string) => number, least: number): FittedName | null {
  const scale = scaleFor(text)
  if (scale >= 1) return { text, scale: 1 }
  if (scale >= least) return { text, scale }
  for (let keep = text.length - 1; keep >= MIN_CHARACTERS; keep--) {
    const short = text.slice(0, keep) + ELLIPSIS
    if (scaleFor(short) >= least) return { text: short, scale: least }
  }
  return null
}

/** The name at full size if it fits `maxWidth`, else smaller (not under MIN_NAME_SCALE), else shortened at that size, else null. */
export function fitName(text: string, maxWidth: number, measure: Measure): FittedName | null {
  return fitScaled(text, (t) => maxWidth / measure(t), MIN_NAME_SCALE)
}

/** How far each of two facing names may reach in `room`: both as they are when they fit, else the short one keeps its reach. */
function allot(room: number, mine: number, theirs: number): number {
  if (mine + theirs <= room) return mine
  const half = room / 2
  if (mine <= half) return mine
  return theirs <= half ? room - theirs : half
}

type Axis = "x" | "y"

/** How far a text reaches along the frame's axis on screen: its width where the axis runs across the screen, else its height. */
const extentOn = (name: PinName, axis: Axis, text: string, measure: Measure) => ((axis === "x") === name.quarter ? name.size : measure(text))

const isSide = (name: PinName) => name.side === "left" || name.side === "right"
/** The axis a name runs into the body along (x for side names, y for top and bottom ones), and the axis its pins are pitched on. */
const inwardOf = (name: PinName): Axis => (isSide(name) ? "x" : "y")
const pitchOf = (name: PinName): Axis => (isSide(name) ? "y" : "x")
/** A side name starts at its pin and runs inward; a top or bottom name is centred on its anchor, so half of it reaches in. */
const reachShare = (name: PinName) => (isSide(name) ? 1 : 0.5)

const OPPOSITE: Record<PinSide, PinSide> = { left: "right", right: "left", top: "bottom", bottom: "top" }

/** The most the name may reach toward the name across the body on its line, or toward its own mirror through the centre. */
function inwardLimit(name: PinName, names: readonly PinName[], measure: Measure, gap: number): number {
  const [inward, pitch] = [inwardOf(name), pitchOf(name)]
  const toward = name.side === "left" || name.side === "bottom" ? 1 : -1
  const reach = (n: PinName) => extentOn(n, inward, n.text, measure) * reachShare(n)
  const sameLine = (other: PinName) => Math.abs(other.local[pitch] - name.local[pitch]) < (extentOn(name, pitch, name.text, measure) + extentOn(other, pitch, other.text, measure)) / 2
  const across = names.filter((other) => other.side === OPPOSITE[name.side] && sameLine(other) && (other.local[inward] - name.local[inward]) * toward > 0)
  const nearest = across.sort((p, q) => Math.abs(p.local[inward] - name.local[inward]) - Math.abs(q.local[inward] - name.local[inward]))[0]
  const room = Math.abs((nearest ? nearest.local[inward] : -name.local[inward]) - name.local[inward]) - gap
  return allot(room, reach(name), nearest ? reach(nearest) : 0) / reachShare(name)
}

/** The most the name may span along its pitch: the distance to its nearest neighbour on its side, less the gap; unlimited without one. */
function pitchLimit(name: PinName, names: readonly PinName[], gap: number): number {
  const pitch = pitchOf(name)
  const pitches = names.filter((other) => other !== name && other.side === name.side).map((other) => Math.abs(other.local[pitch] - name.local[pitch]))
  return pitches.length === 0 ? Infinity : Math.min(...pitches) - gap
}

/** The name fitted to both limits: along the line into the body and along its pitch. */
function fitBoth(name: PinName, names: readonly PinName[], measure: Measure, gap: number, least: number): FittedName | null {
  const inward = inwardLimit(name, names, measure, gap)
  const pitch = pitchLimit(name, names, gap)
  const scaleFor = (text: string) => Math.min(inward / extentOn(name, inwardOf(name), text, measure), pitch / extentOn(name, pitchOf(name), text, measure))
  return fitScaled(name.text, scaleFor, least)
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
 * names and `least` the smallest scale a name is drawn at (70%, or the whole device pixel size just above it). Neighbours on one side that still overlap go first; a name that still overlaps another (a side name against
 * a top or bottom one) goes with it.
 */
export function fitPinNames(names: readonly PinName[], measure: Measure, gap: number, least = MIN_NAME_SCALE): (FittedName | null)[] {
  const fitted = names.map((name) => fitBoth(name, names, measure, gap, least))
  const spans = fitted.map((fit, i) => (fit === null ? null : spanOf(names[i] as PinName, fit, measure)))
  const sameSide = overlapping(spans, (i, j) => names[i]?.side === names[j]?.side)
  const left = spans.map((span, i) => (sameSide.has(i) ? null : span))
  const crossing = overlapping(left, () => true)
  return fitted.map((fit, i) => (sameSide.has(i) || crossing.has(i) ? null : fit))
}
