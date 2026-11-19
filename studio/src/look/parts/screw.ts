// A screw terminal block as the common PCB blocks are moulded (side view: a tall front with the wire entries, a
// chamfer up to a flat top, a short chamfer down the back): one pole per pin with a fine groove between poles, a round
// well sunk into the top with the slotted screw head at its floor, and a square wire entry on the front face (−y) with
// the metal clamp showing at the back of it. A square pin goes through each hole. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, facet, grown, lathe, lying, type Flat, type Piece, type Rect } from "./kit.js"
import type { Rgb, Vec3 } from "../scene.js"

/** The side profile, as shares: the front stands straight up to this share of the height, the flat top starts this
 * share of the depth back from the front, and the back chamfer takes this share of the depth and the height. */
const FRONT_SHARE = 0.72
const TOP_FRONT = 0.2
const BACK_DEPTH = 0.12
const BACK_DROP = 0.18
/** Half the groove between two poles. */
const GROOVE = 0.06
/** The screw well: its radius as a share of the pitch, its clearance to the top's edges, and how deep the head sits. */
const WELL_SHARE = 0.33
const WELL_CLEARANCE = 0.25
const WELL_DEPTH = 1.1
const HEAD_SIDES = 24
/** The slot across the head: its half length (share of the well's radius), half width and rise. */
const SLOT_LENGTH = 0.85
const SLOT_HALF = 0.22
const SLOT_RISE = 0.04
/** The wire entry: its width as a share of the pitch, its band on the front as shares of the height, its depth. */
const ENTRY_SHARE = 0.62
const ENTRY_FROM = 0.2
const ENTRY_TO = 0.56
const ENTRY_DEPTH = 1.6
/** The front is set back from the outline by this much; the outline is shrunk by this much without one. */
const SET_BACK = 0.03
const INSET = 0.15
/** A pin's half size. */
const PIN_HALF = { x: 0.45, y: 0.45 }
/** How much darker the inside of a well or an entry is than the block, and the clamp than tin. */
const SHADOW = 0.55
const CLAMP = 0.7

const DEFAULT_PITCH = 5.08
const MIN_PITCH = 0.5

/** The pitch from the pads: the nearest two along the row. */
function pitchOf(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((x, i) => x - (sorted[i] as number)).filter((gap) => gap > MIN_PITCH)
  return gaps.length === 0 ? DEFAULT_PITCH : Math.min(...gaps)
}

const darker = (color: Rgb, share: number): Rgb => color.map((c) => Math.round(c * share)) as unknown as Rgb

/** The block's side profile in the y–z plane, counter-clockwise seen from +x. */
function profile(front: number, back: number, h: number): Flat[] {
  const depth = back - front
  return [
    { x: front, y: 0 },
    { x: back, y: 0 },
    { x: back, y: h * (1 - BACK_DROP) },
    { x: back - depth * BACK_DEPTH, y: h },
    { x: front + depth * TOP_FRONT, y: h },
    { x: front, y: h * FRONT_SHARE },
  ]
}

interface Pole {
  x0: number
  x1: number
  x: number
  well: { y: number; radius: number }
  entry: { width: number; z0: number; z1: number }
}

/** A square loop in the plane y = `y` (the front face), from x0..x1 and z0..z1. */
const frontLoop = (x0: number, x1: number, z0: number, z1: number, y: number): Vec3[] => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]

/** The front face of a pole with its entry cut out, the entry's four walls, and the clamp at its back. */
function entryPieces(pole: Pole, front: number, h: number, look: ShapeInput["look"]): Piece[] {
  const { width, z0, z1 } = pole.entry
  const [e0, e1] = [pole.x - width / 2, pole.x + width / 2]
  const inner = front + ENTRY_DEPTH
  const shadow = darker(look.body, SHADOW)
  const face = facet(frontLoop(pole.x0, pole.x1, 0, h * FRONT_SHARE, front), [0, -1, 0], look.body, "matt", "body")
  const hole = frontLoop(e0, e1, z0, z1, front).reverse()
  const wall = (loop: Vec3[], outward: Vec3) => facet(loop, outward, shadow, "matt", "body")
  return [
    { ...face, loops: [face.loops[0] as Vec3[], hole] },
    wall([[e0, front, z0], [e1, front, z0], [e1, inner, z0], [e0, inner, z0]], [0, 0, 1]),
    wall([[e0, front, z1], [e1, front, z1], [e1, inner, z1], [e0, inner, z1]], [0, 0, -1]),
    wall([[e0, front, z0], [e0, inner, z0], [e0, inner, z1], [e0, front, z1]], [1, 0, 0]),
    wall([[e1, front, z0], [e1, inner, z0], [e1, inner, z1], [e1, front, z1]], [-1, 0, 0]),
    facet(frontLoop(e0, e1, z0, z1, inner), [0, -1, 0], darker(look.metal, CLAMP), "metal", "body"),
  ]
}

/** The flat top of a pole with the well cut out, the well's wall, and the slotted head at its floor. */
function wellPieces(pole: Pole, top: { y0: number; y1: number }, h: number, look: ShapeInput["look"]): Piece[] {
  const { y, radius } = pole.well
  const ring = Array.from({ length: HEAD_SIDES }, (_, i): Vec3 => {
    const a = (-2 * Math.PI * i) / HEAD_SIDES
    return [pole.x + radius * Math.cos(a), y + radius * Math.sin(a), h]
  })
  const lid: Piece = { loops: [[[pole.x0, top.y0, h], [pole.x1, top.y0, h], [pole.x1, top.y1, h], [pole.x0, top.y1, h]], ring], normal: [0, 0, 1], color: look.body, material: "matt", role: "body" }
  const floor = h - WELL_DEPTH
  const well = lathe([[radius, h], [radius, floor]], pole.x, y, HEAD_SIDES, { top: look.metal, side: darker(look.body, SHADOW) }, "matt", "cap")
  const headTop = well.filter((piece) => piece.normal[2] > 0.99).map((piece): Piece => ({ ...piece, material: "metal" }))
  const walls = well.filter((piece) => piece.normal[2] <= 0.99)
  const slot: Rect = { minX: pole.x - radius * SLOT_LENGTH, maxX: pole.x + radius * SLOT_LENGTH, minY: y - SLOT_HALF, maxY: y + SLOT_HALF }
  return [lid, ...walls, ...headTop, ...box(slot, floor, floor + SLOT_RISE, look.mark, "matt", "cap")]
}

/** The poles along the row: each its pin's share of the outline, with the groove between them. */
function poles(input: ShapeInput, outline: Rect, top: { y0: number; y1: number }, h: number): Pole[] {
  const pitch = pitchOf(input.pads.map((pad) => pad.x))
  const xs = [...new Set(input.pads.map((pad) => Math.round(pad.x * 1000) / 1000))].sort((a, b) => a - b)
  const room = (top.y1 - top.y0) / 2 - WELL_CLEARANCE
  const radius = Math.max(0.4, Math.min(pitch * WELL_SHARE, room))
  return xs.map((x, i) => {
    const pad = input.pads.find((p) => Math.abs(p.x - x) < 1e-3)
    const y = Math.min(Math.max(pad?.y ?? 0, top.y0 + radius + WELL_CLEARANCE), top.y1 - radius - WELL_CLEARANCE)
    const x0 = i === 0 ? outline.minX : (x + (xs[i - 1] as number)) / 2 + GROOVE
    const x1 = i === xs.length - 1 ? outline.maxX : (x + (xs[i + 1] as number)) / 2 - GROOVE
    return { x0, x1, x, well: { y, radius }, entry: { width: pitch * ENTRY_SHARE, z0: h * ENTRY_FROM, z1: h * ENTRY_TO } }
  })
}

export function screwShape(input: ShapeInput): Piece[] {
  const outline: Rect = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const { look } = input
  const h = input.height
  const front = outline.minY + SET_BACK
  const back = outline.maxY
  const depth = back - front
  const top = { y0: front + depth * TOP_FRONT, y1: back - depth * BACK_DEPTH }
  const pieces = poles(input, outline, top, h).flatMap((pole) => {
    const sides = lying(profile(front, back, h), pole.x0, pole.x1, look.body, "matt", "body")
    // The flat top and the straight front are drawn with their holes below; the sweep keeps the rest.
    const kept = sides.filter((piece) => !(piece.normal[2] > 0.99) && !(piece.normal[1] < -0.99))
    return [...kept, ...wellPieces(pole, top, h, look), ...entryPieces(pole, front, h, look)]
  })
  return [...pieces, ...leads(input, look.metal, PIN_HALF)]
}
