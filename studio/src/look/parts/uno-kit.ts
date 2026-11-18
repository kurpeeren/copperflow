// What the shapes of the connectors, switches, resonators and inductors share: walls and rings swept along y from a
// profile in the x–z plane (the face of a receptacle seen from the front), a box open at its back, leads that are flat
// strips through slots, and a terminal folded over the side of a body down onto its pad. Pure.
import type { Pad } from "../../../../src/engine/footprints/types.js"
import type { Material, Rgb, Role } from "../scene.js"
import { leads, padRect, type ShapeInput } from "./input.js"
import { box, facet, type Flat, type Piece, type Rect } from "./kit.js"

/** A profile in the x–z plane: `x` is the part's x, `y` its z. */
export type Profile = readonly Flat[]

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / (values.length || 1)

/** The wall of a profile swept along y from `y0` to `y1`, one flat piece per edge, facing out of the profile or into it. */
export function wallY(profile: Profile, y0: number, y1: number, color: Rgb, material: Material, role: Role, facing: "out" | "in" = "out"): Piece[] {
  if (!(y1 > y0) || profile.length < 3) return []
  const [cx, cz] = [mean(profile.map((p) => p.x)), mean(profile.map((p) => p.y))]
  const sign = facing === "out" ? 1 : -1
  return profile.map((p, i) => {
    const q = profile[(i + 1) % profile.length] as Flat
    const outward: [number, number, number] = [sign * ((p.x + q.x) / 2 - cx), 0, sign * ((p.y + q.y) / 2 - cz)]
    return facet([[p.x, y0, p.y], [q.x, y0, q.y], [q.x, y1, q.y], [p.x, y1, p.y]], outward, color, material, role)
  })
}

/** A profile as one flat piece at `y`, facing +y (`toward` 1) or −y (−1). */
export const capY = (profile: Profile, y: number, toward: 1 | -1, color: Rgb, material: Material, role: Role): Piece =>
  facet(profile.map((p): [number, number, number] => [p.x, y, p.y]), [0, toward, 0], color, material, role)

/** The flat ring between two profiles of the same number of points (the outer one's first) at `y`, facing +y or −y. */
export function ringY(outer: Profile, inner: Profile, y: number, toward: 1 | -1, color: Rgb, material: Material, role: Role): Piece[] {
  if (outer.length !== inner.length) return []
  return outer.map((p, i) => {
    const j = (i + 1) % outer.length
    const [q, a, b] = [outer[j] as Flat, inner[i] as Flat, inner[j] as Flat]
    return facet([[p.x, y, p.y], [q.x, y, q.y], [b.x, y, b.y], [a.x, y, a.y]], [0, toward, 0], color, material, role)
  })
}

/** A rectangle in the x–z plane at `y`, facing +y or −y. */
export const frontRect = (x0: number, x1: number, z0: number, z1: number, y: number, toward: 1 | -1, color: Rgb, material: Material, role: Role): Piece[] =>
  x1 > x0 && z1 > z0 ? [facet([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, toward, 0], color, material, role)] : []

/**
 * A box whose back (+y) is against a wall: its top, bottom, two sides and front, from `y0` (the front) to `y1`, over
 * `rect.minX..maxX` and `z0..z1`. A tongue standing out of the back of a socket.
 */
export function openBox(rect: Pick<Rect, "minX" | "maxX">, y0: number, y1: number, z0: number, z1: number, color: Rgb, material: Material, role: Role): Piece[] {
  if (!(y1 > y0) || !(rect.maxX > rect.minX) || !(z1 > z0)) return []
  const plate = (xa: number, xb: number, ya: number, yb: number, z: number, up: 1 | -1) =>
    facet([[xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z]], [0, 0, up], color, material, role)
  const side = (x: number, out: 1 | -1) => facet([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], [out, 0, 0], color, material, role)
  return [plate(rect.minX, rect.maxX, y0, y1, z1, 1), plate(rect.minX, rect.maxX, y0, y1, z0, -1), side(rect.minX, -1), side(rect.maxX, 1), ...frontRect(rect.minX, rect.maxX, z0, z1, y0, -1, color, material, role)]
}

/** The share of a slot's hole a flat lead fills along each side. */
const SLOT_FILL = 0.8

/** A flat lead through every through-hole pad that `pick` accepts, as wide as `SLOT_FILL` of its hole, or `half` when given. */
export function stripLeads(input: ShapeInput, pick: (pad: Pad) => boolean, color: Rgb, half?: { x: number; y: number }): Piece[] {
  const chosen = input.pads.filter(pick)
  return chosen.flatMap((pad) => {
    const size = half ?? { x: ((pad.drill?.width ?? 0.6) * SLOT_FILL) / 2, y: ((pad.drill?.height ?? 0.6) * SLOT_FILL) / 2 }
    return leads({ ...input, pads: [pad] }, color, size)
  })
}

export interface FoldSpec {
  /** How far the foot reaches out of the body's side at most, its thickness and the height the riser climbs to. */
  reach: number
  thick: number
  rise: number
  /** The most the strip is wide along the side. */
  across: number
}

/** How far the foot tucks in under the body. */
const TUCK = 0.12

/**
 * A terminal folded over the side of a body whose pad lies out of its left or right side: a foot on the pad, tucked a
 * little under the body, and a riser up the side. It stays inside the pad. Nothing when the pad does not reach out.
 */
export function foldedTerminal(pad: Pad, body: Rect, spec: FoldSpec, color: Rgb, role: Role = "leg"): Piece[] {
  const r = padRect(pad)
  const sign = pad.x >= (body.minX + body.maxX) / 2 ? 1 : -1
  const edge = sign > 0 ? body.maxX : body.minX
  const outer = sign > 0 ? r.maxX : r.minX
  const reach = Math.min(spec.reach, Math.abs(outer - edge))
  if (reach < spec.thick) return []
  const half = Math.min(r.maxY - r.minY, spec.across) / 2
  const [near, far] = [edge - sign * TUCK, edge + sign * reach]
  const span = (a: number, b: number) => ({ minX: Math.min(a, b), maxX: Math.max(a, b), minY: pad.y - half, maxY: pad.y + half })
  const foot = box(span(near, far), 0, spec.thick, color, "metal", role)
  const riser = box(span(edge, edge + sign * spec.thick), spec.thick, spec.rise, color, "metal", role)
  return [...foot, ...riser]
}
