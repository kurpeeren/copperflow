// A round through-hole LED as the eye sees a real one: a clear epoxy body tinted in the lens colour (a flange ring on
// the board with a flat at the cathode, pad 2, a cylinder and a domed top, made with a lathe), and inside it the two
// lead frames: the cathode's wide "anvil" carrying a reflector cup with the die on its floor, and the anode's thin
// "post", joined by a hair-thin bond wire from the die's top. Two square leads go on down through the holes. The lens
// is red unless the part's `color` prop names another colour. The frame's sizes follow a typical 5 mm (T-1¾) maker
// drawing and shrink with the lens for the 3 mm one. Pure.
import type { Rgb, Vec3 } from "../scene.js"
import type { FamilyLook } from "./family.js"
import { leads, type ShapeInput } from "./input.js"
import { box, circle, facet, lathe, prism, type Flat, type Piece, type Rect } from "./kit.js"

const SIDES = 24
const DOME_STEPS = 5
/** The flange's thickness: at most this, or this share of the part's height. */
const FLANGE = 1
const FLANGE_SHARE = 0.14
/** The lens is this much narrower than the flange on every side ((5.8 − 5.0) / 2), or this share of it at least. */
const LENS_MARGIN = 0.4
const LENS_MIN_SHARE = 0.7
/** The flat on the flange is the lens colour this much washed towards white, so the cathode side reads. */
const FLANGE_WASH = 0.5
/** A lead's half size (a 0.5 mm square lead). */
const LEAD_HALF = { x: 0.25, y: 0.25 }
const FALLBACK_FLAT = 0.4
/** How much of the colour behind the epoxy shows through: 1 − this. Low enough that the frames inside read clearly. */
const EPOXY_ALPHA = 0.5
/** The hole the lens leaves in the flange's top stops this short of the flat, so the ring never closes to nothing. */
const FLAT_MARGIN = 0.05

/** The 5 mm drawing the frame is scaled from: its lens radius and its height. */
const DRAWING_LENS = 2.5
const DRAWING_HEIGHT = 8.6
/** Half the lead stock's thickness: the frames are stamped from the 0.5 mm leads. */
const STOCK = 0.25
/** The frames keep this far inside the lens wall. */
const WALL = 0.12
/** The leads rise straight to here, where the anvil and the post widen out (z in the drawing, mm). */
const KINK = 2
/** The anvil: its flat top (where the cup sits), how far past the axis it reaches, where its slanted inner edge starts. */
const ANVIL_TOP = 4.3
const ANVIL_REACH = 0.45
const ANVIL_SHOULDER = 3.4
/** The reflector cup: its radius at the foot and at the rim, the rim's lip, its floor and rim heights. */
const CUP_FOOT = 0.45
const CUP_RIM = 0.8
const CUP_LIP = 0.15
const CUP_FLOOR = 4.45
const CUP_TOP = 4.8
const CUP_SIDES = 12
/** The post: the flag it widens into towards the axis, how far up the flag's slant runs, and its top. */
const POST_FLAG = 0.35
const POST_SLANT = 0.5
const POST_TOP = 5
/** The die: its half size and its thickness. */
const DIE_HALF = 0.15
const DIE_THICK = 0.15
/** The bond wire: its half thickness (drawn thicker than the real 25 µm, which no screen shows), its bow, its pieces. */
const WIRE_HALF = 0.035
const WIRE_BOW = 0.6
const WIRE_STEPS = 8

const DIE: { top: Rgb; side: Rgb } = { top: [92, 92, 104], side: [56, 56, 64] }
const GOLD: Rgb = [222, 182, 84]

/** The lens colours a part's `color` prop may name: the body of the lens and the lighter top of its dome. */
const LENS_COLORS = new Map<string, readonly [Rgb, Rgb]>([
  ["red", [[214, 48, 44], [236, 96, 88]]],
  ["green", [[46, 184, 84], [110, 220, 134]]],
  ["blue", [[48, 96, 214], [110, 150, 240]]],
  ["yellow", [[236, 200, 40], [250, 226, 100]]],
  ["white", [[232, 232, 226], [248, 248, 244]]],
])

/** The look with its lens in the colour the part names; anything else (or nothing) keeps red. */
export function ledLook(base: FamilyLook, props: Readonly<Record<string, unknown>> | undefined): FamilyLook {
  const named = props?.["color"]
  const pair = typeof named === "string" ? LENS_COLORS.get(named.trim().toLowerCase()) : undefined
  return pair === undefined ? base : { ...base, body: pair[0], top: pair[1] }
}

const wash = (color: Rgb): Rgb => [0, 1, 2].map((i) => Math.round((color[i] as number) + (255 - (color[i] as number)) * FLANGE_WASH)) as unknown as Rgb
const clear = (pieces: readonly Piece[]): Piece[] => pieces.map((piece) => ({ ...piece, alpha: EPOXY_ALPHA }))

/** A circle cut flat on the cathode side (`sign` is +1 for +x), the flat `cut` along x. */
function cutCircle(radius: number, cut: number, sign: 1 | -1): Flat[] {
  return circle(0, 0, radius, SIDES).map((p) => ({ x: sign === 1 ? Math.min(p.x, cut) : Math.max(p.x, cut), y: p.y }))
}

/** The sizes of one LED in its own frame: x along the pads, the cathode's side `sign`. */
interface Lamp {
  sign: 1 | -1
  /** The anode's and the cathode's distance from the axis. */
  anode: number
  cathode: number
  radius: number
  cut: number
  flange: number
  lens: number
  height: number
  /** The drawing's sizes across and up, scaled to this LED. */
  across: number
  up: number
}

function lampOf(input: ShapeInput): Lamp {
  const body: Rect = input.body ?? input.limit
  const [one, two] = [input.pads.find((p) => p.number === "1") ?? input.pads[0], input.pads.find((p) => p.number === "2") ?? input.pads[1]]
  const sign = one !== undefined && two !== undefined && two.x < one.x ? -1 : 1
  const radius = (body.maxY - body.minY) / 2
  const cut = sign === 1 ? Math.min(body.maxX, radius - FALLBACK_FLAT) : Math.max(body.minX, FALLBACK_FLAT - radius)
  const height = input.height
  const lens = Math.max(radius - LENS_MARGIN, radius * LENS_MIN_SHARE)
  const pitch = one !== undefined && two !== undefined ? Math.abs(two.x - one.x) / 2 : lens / 2
  return {
    sign,
    anode: Math.abs(one?.x ?? -pitch),
    cathode: Math.abs(two?.x ?? pitch),
    radius,
    cut,
    flange: Math.min(FLANGE, height * FLANGE_SHARE),
    lens,
    height,
    across: lens / DRAWING_LENS,
    up: height / DRAWING_HEIGHT,
  }
}

/** The epoxy: the flange (its top a ring round the lens, its flat at the cathode) and the lens over it, all see-through. */
function epoxy(lamp: Lamp, look: FamilyLook): Piece[] {
  const { sign, radius, cut, flange, lens, height } = lamp
  const outline = cutCircle(radius, cut, sign)
  const flat = wash(look.body)
  const onFlat = (i: number) => (outline[i]?.x === cut && outline[(i + 1) % outline.length]?.x === cut ? flat : undefined)
  const flangeColor = look.body
  const sides = prism(outline, 0, flange, flangeColor, "matt", "body", onFlat)
    .slice(1)
    .map((piece) => (Math.abs(piece.normal[0]) > 0.99 && piece.normal[0] * sign > 0 ? { ...piece, role: "cathode" as const } : piece))
  const hole = cutCircle(lens, cut - sign * FLAT_MARGIN, sign).reverse()
  const ring: Piece = { loops: [outline.map((p): Vec3 => [p.x, p.y, flange]), hole.map((p): Vec3 => [p.x, p.y, flange])], normal: [0, 0, 1], color: flangeColor, material: "matt", role: "body" }
  const axis = height - lens
  const dome = Array.from({ length: DOME_STEPS }, (_, k): [number, number] => {
    const angle = (Math.PI / 2) * ((k + 1) / DOME_STEPS)
    return k === DOME_STEPS - 1 ? [0, height] : [lens * Math.cos(angle), axis + lens * Math.sin(angle)]
  })
  const profile: [number, number][] = [[lens, flange], [lens, axis], ...dome]
  const lensPieces = lathe(profile, 0, 0, SIDES, { top: look.top ?? look.body, side: look.body }, "matt", "body")
  return clear([ring, ...sides, ...lensPieces])
}

/**
 * A flat plate of lead stock standing in the x–z plane: a counter-clockwise polygon in (u, z), u running towards the
 * cathode (x = sign·u), STOCK thick across y; its two faces and its edges.
 */
function plate(polygon: readonly Flat[], sign: 1 | -1, color: Rgb, role: Piece["role"]): Piece[] {
  const at = (p: Flat, y: number): Vec3 => [sign * p.x, y, p.y]
  const front = facet(polygon.map((p) => at(p, -STOCK)), [0, -1, 0], color, "metal", role)
  const back = facet(polygon.map((p) => at(p, STOCK)), [0, 1, 0], color, "metal", role)
  const edges = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length] as Flat
    const outward: Vec3 = [sign * (q.y - p.y), 0, -(q.x - p.x)]
    return facet([at(p, -STOCK), at(q, -STOCK), at(q, STOCK), at(p, STOCK)], outward, color, "metal", role)
  })
  return [front, back, ...edges]
}

/** The cathode's anvil: its lead straight up to the kink, then a wide plate reaching past the axis, flat on top. */
function anvil(lamp: Lamp, color: Rgb): Piece[] {
  const { across, up } = lamp
  const limit = lamp.lens - WALL * across
  const c = Math.min(lamp.cathode, limit - LEAD_HALF.x)
  const [inner, outer] = [c - LEAD_HALF.x, Math.min(c + LEAD_HALF.x, limit)]
  const reach = -ANVIL_REACH * across
  const polygon: Flat[] = [
    { x: inner, y: 0 },
    { x: outer, y: 0 },
    { x: outer, y: ANVIL_TOP * up },
    { x: reach, y: ANVIL_TOP * up },
    { x: reach, y: ANVIL_SHOULDER * up },
    { x: inner, y: KINK * up },
  ]
  return plate(polygon, lamp.sign, color, "pin")
}

/** The reflector cup on the anvil's top, round the axis: a bowl with a lip, its floor at CUP_FLOOR. */
function cup(lamp: Lamp, color: Rgb): Piece[] {
  const { across, up } = lamp
  const profile: [number, number][] = [
    [0, ANVIL_TOP * up],
    [CUP_FOOT * across, ANVIL_TOP * up],
    [CUP_RIM * across, CUP_TOP * up],
    [(CUP_RIM - CUP_LIP) * across, CUP_TOP * up],
    [CUP_FOOT * 0.8 * across, CUP_FLOOR * up],
    [0, CUP_FLOOR * up],
  ]
  return lathe(profile, 0, 0, CUP_SIDES, color, "metal", "pin")
}

/** The anode's post: its lead straight up to the kink, then a narrow flag leaning towards the axis. */
function post(lamp: Lamp, color: Rgb): Piece[] {
  const { across, up } = lamp
  const limit = lamp.lens - WALL * across
  const a = -Math.min(lamp.anode, limit - LEAD_HALF.x)
  const [outer, inner] = [Math.max(a - LEAD_HALF.x, -limit), a + LEAD_HALF.x]
  const flag = inner + POST_FLAG * across
  const polygon: Flat[] = [
    { x: outer, y: 0 },
    { x: inner, y: 0 },
    { x: inner, y: KINK * up },
    { x: flag, y: (KINK + POST_SLANT) * up },
    { x: flag, y: POST_TOP * up },
    { x: outer, y: POST_TOP * up },
  ]
  return plate(polygon, lamp.sign, color, "pin")
}

/** The die on the cup's floor, on the axis. */
function die(lamp: Lamp): Piece[] {
  const half = DIE_HALF * lamp.across
  const floor = CUP_FLOOR * lamp.up
  return box({ minX: -half, minY: -half, maxX: half, maxY: half }, floor, floor + DIE_THICK * lamp.up, DIE, "matt", "cap")
}

/** A thin square strand through points in the x–z plane: four sides per piece. */
function strand(points: readonly Vec3[], half: number, color: Rgb): Piece[] {
  return points.slice(1).flatMap((q, k) => {
    const p = points[k] as Vec3
    const length = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1
    const n: Vec3 = [-(q[2] - p[2]) / length * half, 0, (q[0] - p[0]) / length * half]
    const corner = (base: Vec3, s: number, t: number): Vec3 => [base[0] + s * n[0], t * half, base[2] + s * n[2]]
    const side = (s1: number, t1: number, s2: number, t2: number, outward: Vec3) =>
      facet([corner(p, s1, t1), corner(q, s1, t1), corner(q, s2, t2), corner(p, s2, t2)], outward, color, "metal", "pin")
    return [side(1, -1, 1, 1, n), side(-1, -1, -1, 1, [-n[0], 0, -n[2]]), side(-1, -1, 1, -1, [0, -1, 0]), side(-1, 1, 1, 1, [0, 1, 0])]
  })
}

/** The bond wire: from the die's top, bowed up, down onto the post's flag. */
function bondWire(lamp: Lamp): Piece[] {
  const { across, up, sign } = lamp
  const limit = lamp.lens - WALL * across
  const flag = -Math.min(lamp.anode, limit - LEAD_HALF.x) + LEAD_HALF.x + POST_FLAG * across
  const start: Vec3 = [0, 0, (CUP_FLOOR + DIE_THICK) * up]
  const end: Vec3 = [sign * (flag - POST_FLAG * across * 0.5), 0, POST_TOP * up]
  const points = Array.from({ length: WIRE_STEPS + 1 }, (_, i): Vec3 => {
    const t = i / WIRE_STEPS
    return [start[0] + (end[0] - start[0]) * t, 0, start[2] + (end[2] - start[2]) * t + WIRE_BOW * up * Math.sin(Math.PI * t)]
  })
  return strand(points, WIRE_HALF * Math.max(across, 1), GOLD)
}

export function ledShape(input: ShapeInput): Piece[] {
  const lamp = lampOf(input)
  const { look } = input
  const frames = [...anvil(lamp, look.metal), ...cup(lamp, look.metal), ...post(lamp, look.metal), ...die(lamp), ...bondWire(lamp)]
  return [...frames, ...epoxy(lamp, look), ...leads(input, look.metal, LEAD_HALF)]
}
