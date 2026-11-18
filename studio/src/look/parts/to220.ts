// A TO-220 standing upright: a metal tab at the back with its mounting hole, the dark plastic body in front of it and
// flat leads (two, three or five) from the plastic down into the holes (and on through them), seated on the leads'
// shoulders so that a few mm of lead show under the plastic. The footprint's body outline gives where it stands: its
// width, its front, and the back of the tab. The TO-247 is the same with a taller, wider tab and a bigger hole; the
// TO-126 is plastic to the top with its hole in the plastic and no metal tab. Pure.
import type { Material, Rgb, Vec3 } from "../scene.js"
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, facet, grown, prism, rectPolygon, type Piece, type Rect } from "./kit.js"

/** The share of the part's height that body and tab may take at most (the rest is lead under the plastic). */
const BODY_SHARE = 0.85
/** The plastic's share of that height; the tab rises above it. */
const PLASTIC_SHARE = 0.62
/** The tab's share of the outline's depth (its thickness). */
const TAB_SHARE = 0.28
/** The share of the tab above the plastic the mounting hole may take. */
const HOLE_SHARE = 0.3
const HOLE_SIDES = 14
/** Where an all-plastic body's hole sits: this share of the way up the body is below it. */
const PLASTIC_HOLE_FROM = 0.55

/** What differs between the packages of the family, by the code of the string (220, 247, 126). */
interface Spec {
  /** From the plastic's foot to the top, in mm, at most. */
  rise: number
  /** The mounting hole's radius, at most. */
  hole: number
  /** All plastic to the top, the hole in the plastic. */
  plastic: boolean
  /** A lead's half width and half thickness. */
  lead: { x: number; y: number }
}
const SPECS: Readonly<Record<string, Spec>> = {
  "220": { rise: 16, hole: 1.9, plastic: false, lead: { x: 0.4, y: 0.25 } },
  "247": { rise: 21, hole: 2.2, plastic: false, lead: { x: 0.6, y: 0.3 } },
  "126": { rise: 10.8, hole: 1.5, plastic: true, lead: { x: 0.4, y: 0.25 } },
}

interface Hole {
  z: number
  radius: number
}

/** The hole's circle at depth `y`, as points in the x–z plane, counter-clockwise seen from −y. */
const holeRing = (cx: number, hole: Hole, y: number): Vec3[] =>
  Array.from({ length: HOLE_SIDES }, (_, i): Vec3 => [cx + hole.radius * Math.cos((2 * Math.PI * i) / HOLE_SIDES), y, hole.z + hole.radius * Math.sin((2 * Math.PI * i) / HOLE_SIDES)])

/** The hole's wall: flat strips from the front face to the back, facing the hole's axis. */
function holeWall(cx: number, hole: Hole, frontY: number, backY: number, color: Rgb, material: Material): Piece[] {
  const [front, back] = [holeRing(cx, hole, frontY), holeRing(cx, hole, backY)]
  return front.map((f0, i) => {
    const j = (i + 1) % HOLE_SIDES
    const [f1, b0, b1] = [front[j] as Vec3, back[i] as Vec3, back[j] as Vec3]
    const towards: Vec3 = [-((f0[0] + f1[0]) / 2 - cx), 0, -((f0[2] + f1[2]) / 2 - hole.z)]
    return facet([f0, b0, b1, f1], towards, color, material, "body")
  })
}

/** The tab's front face (above the plastic) and back face (full height), each with the hole, and the hole's wall. */
function tabFaces(slab: Rect, zFoot: number, zPlastic: number, top: number, hole: Hole, color: Rgb, material: Material = "metal"): Piece[] {
  const cx = (slab.minX + slab.maxX) / 2
  const [frontY, backY] = [slab.minY, slab.maxY]
  const front: Piece = {
    loops: [[[slab.minX, frontY, zPlastic], [slab.maxX, frontY, zPlastic], [slab.maxX, frontY, top], [slab.minX, frontY, top]], [...holeRing(cx, hole, frontY)].reverse()],
    normal: [0, -1, 0], color, material, role: "body",
  }
  // Seen from +y the x axis runs the other way: the outline is walked right to left, and the hole mirrored.
  const mirrored = holeRing(cx, hole, backY).map((p): Vec3 => [2 * cx - p[0], p[1], p[2]])
  const back: Piece = {
    loops: [[[slab.maxX, backY, zFoot], [slab.minX, backY, zFoot], [slab.minX, backY, top], [slab.maxX, backY, top]], [...mirrored].reverse()],
    normal: [0, 1, 0], color, material, role: "body",
  }
  return [front, back, ...holeWall(cx, hole, frontY, backY, color, material)]
}

/** An all-plastic body (TO-126): the box, its hole through the upper part, and no metal above it. */
function plasticBody(outline: Rect, foot: number, h: number, spec: Spec, color: Rgb): Piece[] {
  const below = foot + (h - foot) * PLASTIC_HOLE_FROM
  const hole = Math.min(spec.hole, (h - below) * HOLE_SHARE, (outline.maxX - outline.minX) / 2 - 0.2)
  const upper = (below + h) / 2
  const front = box(outline, foot, below, color, "matt", "body").filter((piece) => piece.normal[1] < -0.5)
  const sides = prism(rectPolygon(outline), foot, h, color, "matt", "body").filter((piece) => Math.abs(piece.normal[1]) < 0.5)
  return [...front, ...sides, ...tabFaces(outline, foot, below, h, { z: upper, radius: hole }, color, "matt")]
}

export function to220Shape(input: ShapeInput): Piece[] {
  const outline = clipped(input.body ?? grown(input.limit, -0.2), input.limit)
  const { look } = input
  const spec = SPECS[input.parsed?.code ?? "220"] ?? (SPECS["220"] as Spec)
  const h = input.height
  const rise = Math.min(spec.rise, h * BODY_SHARE)
  const foot = h - rise
  const pieces: Piece[] = spec.plastic ? plasticBody(outline, foot, h, spec, look.body) : tabbedBody(outline, foot, h, rise, spec, look)
  for (const pad of input.pads) {
    const strip = { minX: pad.x - spec.lead.x, maxX: pad.x + spec.lead.x, minY: pad.y - spec.lead.y, maxY: pad.y + spec.lead.y }
    pieces.push(...box(strip, 0, foot, look.metal, "metal", "leg"))
  }
  return [...pieces, ...leads(input, look.metal, spec.lead)]
}

/** The plastic body in front and the metal tab with its hole behind it and above it. */
function tabbedBody(outline: Rect, foot: number, h: number, rise: number, spec: Spec, look: ShapeInput["look"]): Piece[] {
  const plasticTop = foot + rise * PLASTIC_SHARE
  const frontY = outline.maxY - (outline.maxY - outline.minY) * TAB_SHARE
  const radius = Math.min(spec.hole, (h - plasticTop) * HOLE_SHARE, (outline.maxX - outline.minX) / 2 - 0.2)
  const slab: Rect = { minX: outline.minX, maxX: outline.maxX, minY: frontY, maxY: outline.maxY }
  const sides = prism(rectPolygon(slab), foot, h, look.metal, "metal", "body").filter((piece) => Math.abs(piece.normal[1]) < 0.5)
  return [
    ...box({ ...outline, maxY: frontY }, foot, plasticTop, look.body, "matt", "body"),
    ...sides,
    ...tabFaces(slab, foot, plasticTop, h, { z: (plasticTop + h) / 2, radius }, look.metal),
  ]
}
