// What a radial electrolytic capacitor has printed on its sleeve: its capacitance and rated voltage on one line reading
// up the can, repeated up it, in a column either side of the stripe and one opposite it, as makers print them; and on
// the stripe over the minus lead, chevrons pointing down the can with a minus bar in each. The strokes are thin flat strips laid on the can, each on the plane that touches the can
// at its middle, so every piece stays flat. Pure.
import { textStrokes, textWidth } from "../../../../src/engine/fab/stroke-font.js"
import { microfaradsOf, ratedVolts } from "../../../../src/engine/solid/radial-ratings.js"
import type { Rgb, Vec3 } from "../scene.js"
import { facet, prism, type Flat, type Piece } from "./kit.js"

/** The print stands this far off the sleeve, so it is never inside the can's faceted side. */
export const LIFT = 0.03
/** The tallest a printed letter is (across the can), and its stroke as a share of that. */
const MAX_LETTER = 1.1
const STROKE_SHARE = 0.15
/** The space between two lines of print, as a share of a letter's height. */
const LINE_GAP = 1.6
/** A stroke is cut into pieces no longer than this round the can, so each lies close to the curve. */
const PIECE = 0.25
/** The space between two repeats of the line up the can, as a share of a letter's height. */
const REPEAT_GAP = 2.5
/** A letter is at most this share of the can's radius; a line that would come out smaller goes on two lines. */
const LETTER_SHARE = 0.42
const LEAST_LETTER = 0.45
/** The stripe covers this angle either side of the minus lead. */
export const STRIPE_HALF = Math.PI / 4
/** The stripe's marks: a chevron and a bar every this share of the can's radius (at least MARK_LEAST mm); the chevron's
 * arms reach this share of the stripe's half width and rise this share of the pitch; the bar is this share of it. */
const MARK_PITCH_SHARE = 1.1
const MARK_LEAST = 1.4
const ARM_REACH = 0.75
const ARM_RISE = 0.45
const BAR_SHARE = 0.55
const ARM_THICKNESS = 0.16
const BAR_THICKNESS = 0.26

export interface Can {
  cx: number
  cy: number
  radius: number
  /** The band of the sleeve that may be printed on, from z0 up to z1. */
  z0: number
  z1: number
  /** The angle of the minus lead from the can's centre. */
  towards: number
}

type Point2 = { z: number; s: number }

/** The lines printed on the can: "100µF" and "25V" from the part's props; nothing without a capacitance. */
export function printedLines(props: Readonly<Record<string, unknown>> | undefined): string[] {
  if (props === undefined) return []
  const microfarads = microfaradsOf(props)
  if (microfarads === undefined) return []
  const volts = ratedVolts(props)
  const value = `${Number(microfarads.toPrecision(3))}µF`
  return volts === undefined ? [value] : [value, `${Number(volts.toPrecision(3))}V`]
}

/** One straight stroke from a to b (z up the can, s round it), `width` wide, laid on the can at angle `centre`. */
function strip(can: Can, centre: number, a: Point2, b: Point2, width: number, color: Rgb): Piece[] {
  const length = Math.hypot(b.z - a.z, b.s - a.s)
  const steps = Math.max(1, Math.ceil(Math.abs(b.s - a.s) / PIECE))
  const [dz, ds] = length < 1e-9 ? [1, 0] : [(b.z - a.z) / length, (b.s - a.s) / length]
  const [nz, ns] = [-ds * (width / 2), dz * (width / 2)]
  const reach = length < 1e-9 ? width / 2 : 0
  const pieces: Piece[] = []
  for (let i = 0; i < steps; i++) {
    const p = { z: a.z + ((b.z - a.z) * i) / steps - dz * reach, s: a.s + ((b.s - a.s) * i) / steps - ds * reach }
    const q = { z: a.z + ((b.z - a.z) * (i + 1)) / steps + dz * reach, s: a.s + ((b.s - a.s) * (i + 1)) / steps + ds * reach }
    const mid = (p.s + q.s) / 2
    const angle = centre + mid / can.radius
    const [rx, ry] = [Math.cos(angle), Math.sin(angle)]
    const at = (z: number, s: number): Vec3 => [
      can.cx + (can.radius + LIFT) * rx - (s - mid) * ry,
      can.cy + (can.radius + LIFT) * ry + (s - mid) * rx,
      z,
    ]
    const loop = [at(p.z + nz, p.s + ns), at(p.z - nz, p.s - ns), at(q.z - nz, q.s - ns), at(q.z + nz, q.s + ns)]
    pieces.push(facet(loop, [rx, ry, 0], color, "matt", "body"))
  }
  return pieces
}

/** One line of print as strokes reading up the can, its middle at height `zc`, centred on the angle `centre`. */
function lineAt(can: Can, centre: number, line: string, letter: number, zc: number, offset: number, color: Rgb): Piece[] {
  // Reading up the can: the text's x runs up (z); its up points back round the can (-s), as a column of print does.
  return textStrokes(line, { x: 0, y: 0 }, letter).flatMap((stroke) => {
    const points = stroke.map((p): Point2 => ({ z: zc + p.x, s: offset - p.y }))
    if (points.length === 1) return strip(can, centre, points[0] as Point2, points[0] as Point2, letter * STROKE_SHARE, color)
    return points.slice(1).flatMap((q, k) => strip(can, centre, points[k] as Point2, q, letter * STROKE_SHARE, color))
  })
}

/**
 * The print in a column at the angle `centre`: value and voltage on one line, repeated up the band as often as it fits;
 * on a can too small for that, the two on two lines once.
 */
function columnAt(can: Can, centre: number, lines: readonly string[], color: Rgb): Piece[] {
  const span = can.z1 - can.z0
  const one = lines.join(" ")
  const letter = Math.min(MAX_LETTER, can.radius * LETTER_SHARE, span / textWidth(one, 1))
  if (letter >= LEAST_LETTER || lines.length === 1) {
    if (!(letter > 0.2)) return []
    const length = textWidth(one, letter)
    const gap = letter * REPEAT_GAP
    const count = Math.max(1, Math.floor((span + gap) / (length + gap)))
    const first = (can.z0 + can.z1) / 2 - ((count - 1) * (length + gap)) / 2
    return Array.from({ length: count }, (_, i) => lineAt(can, centre, one, letter, first + i * (length + gap), 0, color)).flat()
  }
  const widest = Math.max(...lines.map((line) => textWidth(line, 1)))
  const small = Math.min(MAX_LETTER, span / widest, (can.radius * 1.4) / (lines.length * LINE_GAP))
  if (!(small > 0.2)) return []
  const zc = (can.z0 + can.z1) / 2
  return lines.flatMap((line, i) => lineAt(can, centre, line, small, zc, (i - (lines.length - 1) / 2) * small * LINE_GAP, color))
}

/** The stripe's marks: chevrons pointing down the can, a minus bar standing in each. */
function stripeMarks(can: Can, color: Rgb): Piece[] {
  const half = can.radius * STRIPE_HALF * ARM_REACH
  const pitch = Math.max(MARK_LEAST, can.radius * MARK_PITCH_SHARE)
  const count = Math.floor((can.z1 - can.z0) / pitch)
  if (count < 1 || half < 0.2) return []
  const start = (can.z0 + can.z1) / 2 - (count * pitch) / 2
  return Array.from({ length: count }, (_, i) => start + i * pitch).flatMap((z) => {
    const tip = { z, s: 0 }
    const rise = z + pitch * ARM_RISE
    const from = z + pitch * ((1 - BAR_SHARE) / 2 + 0.15)
    const to = Math.min(z + pitch * ((1 + BAR_SHARE) / 2 + 0.15), can.z1)
    return [
      ...strip(can, can.towards, { z: rise, s: -half }, tip, ARM_THICKNESS, color),
      ...strip(can, can.towards, tip, { z: rise, s: half }, ARM_THICKNESS, color),
      ...strip(can, can.towards, { z: from, s: 0 }, { z: to, s: 0 }, BAR_THICKNESS, color),
    ]
  })
}

/** The print on the sleeve: the value in columns beside the stripe and opposite it in `ink`, the stripe's marks in `stripeInk`. */
export function sleevePrint(can: Can, lines: readonly string[], ink: Rgb, stripeInk: Rgb): Piece[] {
  const beside = STRIPE_HALF + Math.max(0.35, (MAX_LETTER * 1.2) / can.radius)
  const turns = [beside, -beside, Math.PI]
  const text = lines.length === 0 ? [] : turns.flatMap((turn) => columnAt(can, can.towards + turn, lines, ink))
  return [...text, ...stripeMarks(can, stripeInk)]
}

/** A flat stroke on a lid at height z, from a to b (x, y), `width` wide. */
function flatStrip(a: Flat, b: Flat, width: number, z: number, color: Rgb): Piece[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const [dx, dy] = length < 1e-9 ? [1, 0] : [(b.x - a.x) / length, (b.y - a.y) / length]
  const [nx, ny] = [-dy * (width / 2), dx * (width / 2)]
  const [ex, ey] = length < 1e-9 ? [dx * (width / 2), dy * (width / 2)] : [0, 0]
  const loop: Flat[] = [
    { x: a.x - nx - ex, y: a.y - ny - ey },
    { x: b.x - nx + ex, y: b.y - ny + ey },
    { x: b.x + nx + ex, y: b.y + ny + ey },
    { x: a.x + nx - ex, y: a.y + ny - ey },
  ]
  return prism(loop, z, z + LIFT, color, "matt", "body").slice(0, 1)
}

/**
 * The lines printed flat on a part's top, centred on (x, y): at most `along` long and `across` wide. `turned` (the
 * default) reads them up the top (+y), as a surface-mount can carries them beside its dark minus segment; otherwise
 * they read along x, the lines stacked down y.
 */
export function lidPrint(at: Flat, along: number, across: number, z: number, lines: readonly string[], ink: Rgb, turned = true): Piece[] {
  if (lines.length === 0) return []
  const widest = Math.max(...lines.map((line) => textWidth(line, 1)))
  const letter = Math.min(MAX_LETTER, along / widest, across / (lines.length * LINE_GAP))
  if (!(letter > 0.2)) return []
  return lines.flatMap((line, i) => {
    const offset = (i - (lines.length - 1) / 2) * letter * LINE_GAP
    // Turned a quarter, the text reads up the lid and its lines stack from left to right; flat, they stack downwards.
    const centre = turned ? { x: at.x + offset, y: at.y } : { x: at.x, y: at.y - offset }
    return textStrokes(line, centre, letter, false, turned).flatMap((stroke) => {
      if (stroke.length === 1) return flatStrip(stroke[0] as Flat, stroke[0] as Flat, letter * STROKE_SHARE, z, ink)
      return stroke.slice(1).flatMap((q, k) => flatStrip(stroke[k] as Flat, q, letter * STROKE_SHARE, z, ink))
    })
  })
}
