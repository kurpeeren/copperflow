// Cans: a crystal (HC-49) as a metal can with rounded ends along its two leads, and an electrolytic capacitor as a
// round can in a black sleeve, with a wide white stripe on the minus side (pad 2), a sealing groove near the board, the lip
// rolled over the top edge, a metal lid scored with a vent cross, and its value and voltage printed up the sleeve.
// Both with their leads. Pure.
import { clipPieces } from "./chip.js"
import { lathe, prism, stadium, turnPieces, type Flat, type Piece } from "./kit.js"
import { leads, type ShapeInput } from "./input.js"
import { printedLines, sleevePrint, STRIPE_HALF } from "./sleeve-print.js"

const MARGIN = 0.15

export function crystalShape(input: ShapeInput): Piece[] {
  const [one, two] = [input.pads.find((p) => p.number === "1") ?? input.pads[0], input.pads.find((p) => p.number === "2") ?? input.pads[1]]
  if (one === undefined || two === undefined) return leads(input)
  const angle = (Math.atan2(two.y - one.y, two.x - one.x) * 180) / Math.PI
  const mid = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }
  const flat = Math.abs(Math.sin((angle * Math.PI) / 180)) > 0.7
  const limit = input.body ?? input.limit
  const along = (flat ? limit.maxY - limit.minY : limit.maxX - limit.minX) - 2 * MARGIN
  const across = (flat ? limit.maxX - limit.minX : limit.maxY - limit.minY) - 2 * MARGIN
  const width = Math.min(across, along * 0.6)
  const h = input.height
  const { look } = input
  const flange = Math.min(0.5, h * 0.1)
  const pieces = [
    ...prism(stadium(0, 0, along, width), 0, flange, look.body, "metal", "body"),
    ...prism(stadium(0, 0, along - 0.3, width - 0.3), flange, h, look.body, "metal", "body"),
  ]
  const moved = turnPieces(pieces, angle).map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [p[0] + mid.x, p[1] + mid.y, p[2]])) }))
  return [...clipPieces(moved, input.limit), ...leads(input)]
}

/** Enough sides that the can reads round, not faceted. */
const SIDES = 48
/** The sleeve: a bevel where it sits on the board, the sealing groove rolled into the can above it, and the lip it
 * rolls over the top edge. In mm, shrunk on small cans. */
const SEAT = 0.2
const GROOVE_DEPTH = 0.18
const GROOVE_HEIGHT = 0.5
const LIP = 0.35
/** The print keeps this far from the groove and the lip. */
const PRINT_MARGIN = 0.3
/** The vent scored into the lid: a cross, its bars this wide, this share of the lid across. */
const VENT_WIDTH = 0.14
const VENT_SHARE = 0.75
/** Makers score a pressure relief vent into the lid from 6.3 mm cans up (Nichicon's radial lead drawing); the can drawn
 * is a little narrower than its footprint's circle, so the threshold allows for that. */
const VENT_FROM_DIAMETER = 6.3 - 0.4
/** The vent is pressed into the lid, so it reads a little darker. */
const VENT_SHADE = 0.72

/** The sleeve's profile, (radius, z) from the board up: seat bevel, groove, straight side, the lip rolled over the top. */
function sleeveProfile(radius: number, h: number): [number, number][] {
  const s = Math.min(1, radius / 2.5, h / 5)
  const [seat, depth, groove, lip] = [SEAT * s, GROOVE_DEPTH * s, GROOVE_HEIGHT * s, LIP * s]
  const g0 = Math.min(1.0, h * 0.15)
  return [
    [radius - seat, 0],
    [radius, seat],
    [radius, g0],
    [radius - depth, g0 + groove * 0.3],
    [radius - depth, g0 + groove * 0.7],
    [radius, g0 + groove],
    [radius, h - lip],
    [radius - lip * 0.25, h - lip * 0.35],
    [radius - lip * 0.7, h - lip * 0.05],
    [radius - lip, h - lip * 0.05],
  ]
}

/** The vent: two bars crossing at the lid's centre, laid on it, at 45° so they do not line up with the stripe. */
function vent(cx: number, cy: number, radius: number, z: number, color: ShapeInput["look"]["metal"], canRadius: number): Piece[] {
  if (canRadius * 2 < VENT_FROM_DIAMETER || radius < 1.2) return []
  const half = radius * VENT_SHARE
  const w = (VENT_WIDTH * Math.min(1, radius / 2.5)) / 2
  const bar = (angle: number): Flat[] => {
    const [c, s] = [Math.cos(angle), Math.sin(angle)]
    const at = (u: number, v: number): Flat => ({ x: cx + u * c - v * s, y: cy + u * s + v * c })
    return [at(-half, -w), at(half, -w), at(half, w), at(-half, w)]
  }
  return [...prism(bar(Math.PI / 4), z, z + 0.02, color, "metal", "body"), ...prism(bar(-Math.PI / 4), z, z + 0.02, color, "metal", "body")]
}

export function electrolyticShape(input: ShapeInput): Piece[] {
  const limit = input.limit
  const radius = Math.min(limit.maxX - limit.minX, limit.maxY - limit.minY) / 2 - MARGIN
  const cx = (limit.minX + limit.maxX) / 2
  const cy = (limit.minY + limit.maxY) / 2
  const minus = input.pads.find((p) => p.number === "2")
  const towards = minus === undefined ? 0 : Math.atan2(minus.y - cy, minus.x - cx)
  const h = input.height
  const { look } = input
  const lidColor = look.top ?? look.metal
  const stripe = (i: number) => {
    const a = (2 * Math.PI * (i + 0.5)) / SIDES
    const off = Math.abs(Math.atan2(Math.sin(a - towards), Math.cos(a - towards)))
    return off < STRIPE_HALF ? look.mark : undefined
  }
  const profile = sleeveProfile(radius, h)
  const [lidRadius, lidZ] = profile[profile.length - 1] as [number, number]
  const shade = lidColor.map((c) => Math.round(c * VENT_SHADE)) as unknown as typeof lidColor
  const pieces = [
    ...lathe(profile, cx, cy, SIDES, { top: lidColor, side: look.body }, "matt", "body", stripe),
    ...vent(cx, cy, lidRadius, lidZ, shade, radius),
  ]
  // Printed between the groove and the lip: the value and voltage reading up the can, minus signs on the stripe.
  const [grooveTop, lipStart] = [(profile[5] as [number, number])[1], (profile[6] as [number, number])[1]]
  const band = { z0: grooveTop + PRINT_MARGIN, z1: lipStart - PRINT_MARGIN }
  const print = band.z1 > band.z0 ? sleevePrint({ cx, cy, radius, ...band, towards }, printedLines(input.props), look.mark, look.body) : []
  return [...clipPieces([...pieces, ...print], input.limit), ...leads(input)]
}
