// A round through-hole LED: a flange ring on the board with a flat at the cathode (pad 2), a cylinder and a domed lens on
// it (a lathe), two square leads through the holes. The lens is red unless the part's `color` prop says another colour.
import type { Rgb } from "../scene.js"
import type { FamilyLook } from "./family.js"
import { leads, type ShapeInput } from "./input.js"
import { circle, lathe, prism, type Flat, type Piece, type Rect } from "./kit.js"

const SIDES = 24
const DOME_STEPS = 5
/** The flange's thickness: at most this, or this share of the part's height. */
const FLANGE = 1
const FLANGE_SHARE = 0.14
/** The lens is this much narrower than the flange on every side, or this share of it at least. */
const LENS_MARGIN = 0.4
const LENS_MIN_SHARE = 0.7
/** The flange is the lens colour this much washed towards white. */
const FLANGE_WASH = 0.5
/** A lead's half size (a 0.5 mm square lead). */
const LEAD_HALF = { x: 0.25, y: 0.25 }
const FALLBACK_FLAT = 0.4

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

/** The flange's outline: a circle cut flat on the cathode side (`sign` is +1 for +x), the flat `cut` along x. */
function flangeOutline(radius: number, cut: number, sign: 1 | -1): Flat[] {
  return circle(0, 0, radius, SIDES).map((p) => ({ x: sign === 1 ? Math.min(p.x, cut) : Math.max(p.x, cut), y: p.y }))
}

export function ledShape(input: ShapeInput): Piece[] {
  const body: Rect = input.body ?? input.limit
  const { look } = input
  const [one, two] = [input.pads.find((p) => p.number === "1") ?? input.pads[0], input.pads.find((p) => p.number === "2") ?? input.pads[1]]
  const sign = one !== undefined && two !== undefined && two.x < one.x ? -1 : 1
  const radius = (body.maxY - body.minY) / 2
  const cut = sign === 1 ? Math.min(body.maxX, radius - FALLBACK_FLAT) : Math.max(body.minX, FALLBACK_FLAT - radius)
  const h = input.height
  const flange = Math.min(FLANGE, h * FLANGE_SHARE)
  const lens = Math.max(radius - LENS_MARGIN, radius * LENS_MIN_SHARE)
  const axis = h - lens
  const outline = flangeOutline(radius, cut, sign)
  const onFlat = (i: number) => (outline[i]?.x === cut && outline[(i + 1) % outline.length]?.x === cut ? look.mark : undefined)
  const flangeColor = wash(look.body)
  const ring = prism(outline, 0, flange, flangeColor, "matt", "body", onFlat).map((piece) => (Math.abs(piece.normal[0]) > 0.99 && piece.normal[0] * sign > 0 ? { ...piece, role: "cathode" as const } : piece))
  const dome = Array.from({ length: DOME_STEPS }, (_, k): [number, number] => {
    const angle = (Math.PI / 2) * ((k + 1) / DOME_STEPS)
    return k === DOME_STEPS - 1 ? [0, h] : [lens * Math.cos(angle), axis + lens * Math.sin(angle)]
  })
  const profile: [number, number][] = [[lens, flange], [lens, axis], ...dome]
  const lensPieces = lathe(profile, 0, 0, SIDES, { top: look.top ?? look.body, side: look.body }, "matt", "body")
  return [...ring, ...lensPieces, ...leads(input, look.metal, LEAD_HALF)]
}
