// The shape strings of an EasyEDA Standard PCB document (docType "3"): one line per object, its fields joined by "~".
// Lengths are in the format's unit, 10 mil (0.254 mm); y points down from the document's origin, so a board point
// (x, y) in mm, y up, lands at (ORIGIN.x + x / UNIT, ORIGIN.y - y / UNIT) and EasyEDA shows copperflow's own
// coordinates when its origin is at ORIGIN. Rotations are degrees counter-clockwise as seen, as copperflow's are.
// Field orders come from the public format description and from documents the editor writes. Pure.
import type { Point } from "../model.js"

/** One format unit in mm: 10 mil. */
export const UNIT = 0.254
/** Where the board's (0, 0) lands in the document, in format units: the editor's usual canvas origin. */
export const ORIGIN: Readonly<Point> = { x: 4000, y: 3000 }
/** The sub-shapes of a footprint (LIB) follow its own fields, each one joined to the last by this. */
export const LIB_SEPARATOR = "#@$"
/** Format units are written with at most this many decimals, as the editor writes them. */
const DECIMALS = 4

/** The format's layer ids. */
export const LAYER = {
  top: 1,
  bottom: 2,
  topSilk: 3,
  bottomSilk: 4,
  topPaste: 5,
  bottomPaste: 6,
  topMask: 7,
  bottomMask: 8,
  outline: 10,
  multi: 11,
  document: 12,
  topAssembly: 13,
  bottomAssembly: 14,
  inner1: 21,
  inner2: 22,
} as const

/** A number as the document writes it: rounded to DECIMALS, never "-0" or an exponent. */
export function num(value: number): string {
  const rounded = Number(value.toFixed(DECIMALS))
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

/** A length in mm as format units. */
export const units = (mm: number): string => num(mm / UNIT)

/** A board point in mm (y up) as a document point in format units (y down). */
export const toDocument = (p: Point): Point => ({ x: ORIGIN.x + p.x / UNIT, y: ORIGIN.y - p.y / UNIT })

/** A document point in format units back in board mm. */
export const toBoard = (p: Point): Point => ({ x: (p.x - ORIGIN.x) * UNIT, y: (ORIGIN.y - p.y) * UNIT })

/** "x y x y …": the points as a TRACK's or PAD's point list, in format units. */
export function pointList(points: readonly Point[]): string {
  return points.map((p) => `${num(toDocument(p).x)} ${num(toDocument(p).y)}`).join(" ")
}

/** "M x y L x y … Z": a closed ring as the path a SOLIDREGION or COPPERAREA takes. */
export function ringPath(ring: readonly Point[]): string {
  return `${linePath(ring)} Z`
}

/** "M x y L x y …": an open polyline as path data. */
export function linePath(points: readonly Point[]): string {
  return points
    .map((p, i) => {
      const at = toDocument(p)
      return `${i === 0 ? "M" : "L"} ${num(at.x)} ${num(at.y)}`
    })
    .join(" ")
}

/** Text as a field: the separators the format splits on cannot appear in it, so each becomes "_". */
export function field(text: string): string {
  return text.split(LIB_SEPARATOR).join("_").replace(/[~`]/g, "_")
}

const shape = (kind: string, fields: readonly (string | number)[]): string => [kind, ...fields.map(String)].join("~")

export interface TrackShape {
  width: number
  layer: number
  net: string
  points: readonly Point[]
  id: string
}

/** TRACK~width~layer~net~points~id~locked: a polyline of copper, silkscreen or outline. */
export const trackShape = (t: TrackShape): string => shape("TRACK", [units(t.width), t.layer, field(t.net), pointList(t.points), t.id, 0])

export interface ViaShape {
  at: Point
  diameter: number
  drill: number
  net: string
  id: string
}

/** VIA~x~y~diameter~net~hole radius~id~locked. */
export function viaShape(v: ViaShape): string {
  const at = toDocument(v.at)
  return shape("VIA", [num(at.x), num(at.y), units(v.diameter), field(v.net), units(v.drill / 2), v.id, 0])
}

/** HOLE~x~y~hole radius~id~locked: a non-plated hole. */
export function holeShape(hole: { at: Point; diameter: number; id: string }): string {
  const at = toDocument(hole.at)
  return shape("HOLE", [num(at.x), num(at.y), units(hole.diameter / 2), hole.id, 0])
}

export type EasyedaPadShape = "ELLIPSE" | "RECT" | "OVAL"

export interface PadShape {
  shape: EasyedaPadShape
  at: Point
  width: number
  height: number
  layer: number
  net: string
  number: string
  /** Degrees counter-clockwise. */
  rotation: number
  /** Through pads only: the hole's size along the pad's own x and y. */
  drill?: { width: number; height: number }
  id: string
}

/** The four corners of a w × h rectangle centred on `at`, turned `rotation` degrees counter-clockwise, in mm. */
export function rectCorners(at: Point, width: number, height: number, rotation: number): Point[] {
  const turn = turner(rotation)
  return [
    [-width / 2, height / 2],
    [width / 2, height / 2],
    [width / 2, -height / 2],
    [-width / 2, -height / 2],
  ].map(([x, y]) => {
    const p = turn({ x: x as number, y: y as number })
    return { x: at.x + p.x, y: at.y + p.y }
  })
}

/** A function turning a point about (0, 0) by `rotation` degrees counter-clockwise. */
export function turner(rotation: number): (p: Point) => Point {
  const radians = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  return (p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })
}

/**
 * A slot's two end centres, in mm: along the longer of the hole's sides, turned with the pad, each one half the
 * slot's width in from its end. None for a round hole.
 */
export function slotEnds(pad: Pick<PadShape, "at" | "rotation" | "drill">): Point[] {
  const drill = pad.drill
  if (drill === undefined || drill.width === drill.height) return []
  const reach = (Math.max(drill.width, drill.height) - Math.min(drill.width, drill.height)) / 2
  const along = drill.width > drill.height ? { x: reach, y: 0 } : { x: 0, y: reach }
  const d = turner(pad.rotation)(along)
  return [
    { x: pad.at.x - d.x, y: pad.at.y - d.y },
    { x: pad.at.x + d.x, y: pad.at.y + d.y },
  ]
}

/**
 * PAD~shape~x~y~width~height~layer~net~number~hole radius~points~rotation~id~slot length~slot points~plated~locked
 * ~paste expansion~mask expansion~hole centre. A slot's radius is half its width and its length the whole slot's; the
 * expansions are left empty, so the editor's own apply.
 */
export function padShape(pad: PadShape): string {
  const at = toDocument(pad.at)
  const drill = pad.drill
  const holeRadius = drill === undefined ? 0 : Math.min(drill.width, drill.height) / 2
  const slot = drill === undefined || drill.width === drill.height ? 0 : Math.max(drill.width, drill.height)
  const corners = pad.shape === "RECT" ? pointList(rectCorners(pad.at, pad.width, pad.height, pad.rotation)) : ""
  return shape("PAD", [
    pad.shape,
    num(at.x),
    num(at.y),
    units(pad.width),
    units(pad.height),
    pad.layer,
    field(pad.net),
    field(pad.number),
    units(holeRadius),
    corners,
    num(pad.rotation),
    pad.id,
    units(slot),
    pointList(slotEnds(pad)),
    "Y",
    0,
    "",
    "",
    `${num(at.x)},${num(at.y)}`,
  ])
}

/** L: a free text; P: a footprint's designator; N: a footprint's name. */
export type TextKind = "L" | "P" | "N"

export interface TextShape {
  kind: TextKind
  /** The text's start, in mm: the left end of its baseline before a mirror, which then puts it at the right end. */
  start: Point
  lineWidth: number
  /** Degrees counter-clockwise, applied before the mirror. */
  rotation: number
  mirrored: boolean
  layer: number
  /** The text's height, in mm. */
  height: number
  text: string
  /** The strokes as drawn, in mm. */
  strokes: readonly Point[][]
  shown: boolean
  id: string
}

/**
 * TEXT~kind~x~y~line width~rotation~mirror~layer~net~font size~text~path~display~id~font~locked~: "none" hides it; the
 * last field is one the editor writes and leaves empty here.
 */
export function textShape(t: TextShape): string {
  const at = toDocument(t.start)
  const path = t.strokes
    .filter((line) => line.length > 0)
    .map(linePath)
    .join(" ")
  return shape("TEXT", [t.kind, num(at.x), num(at.y), units(t.lineWidth), num(t.rotation), t.mirrored ? 1 : 0, t.layer, "", units(t.height), field(t.text), path, t.shown ? "" : "none", t.id, "", 0, ""])
}

/** SOLIDREGION~layer~net~path~type~id~~~~locked: a filled area; "solid" is copper, ink or a mask opening. */
export const solidRegionShape = (region: { layer: number; net: string; ring: readonly Point[]; id: string }): string =>
  shape("SOLIDREGION", [region.layer, field(region.net), ringPath(region.ring), "solid", region.id, "", "", "", 0])

export interface CopperAreaShape {
  /** The narrowest copper the fill keeps, in mm. */
  minWidth: number
  layer: number
  net: string
  outline: readonly Point[]
  clearance: number
  thermal: "spoke" | "direct"
  id: string
}

/**
 * COPPERAREA~width~layer~net~outline~clearance~fill style~id~thermal~keep islands~fill~locked: the outline only, with
 * an empty fill ("[]"), which the editor computes again when its copper areas are rebuilt.
 */
export const copperAreaShape = (area: CopperAreaShape): string =>
  shape("COPPERAREA", [units(area.minWidth), area.layer, field(area.net), ringPath(area.outline), units(area.clearance), "solid", area.id, area.thermal, "none", "[]", 0])

export interface LibShape {
  at: Point
  /** The footprint's attributes, as key and value. */
  attributes: readonly (readonly [string, string])[]
  rotation: number
  side: "top" | "bottom"
  id: string
  /** The footprint's own shapes, already in board coordinates. */
  children: readonly string[]
}

/**
 * LIB~x~y~attributes~rotation~import flag~id~layer~~~0~~yes~~ then each child after LIB_SEPARATOR: a footprint, its
 * attributes "key`value`key`value`". The layer is 1 for a part on the top, 2 on the bottom.
 */
export function libShape(lib: LibShape): string {
  const at = toDocument(lib.at)
  const attributes = lib.attributes.map(([key, value]) => `${field(key)}\`${field(value)}\``).join("")
  const head = shape("LIB", [num(at.x), num(at.y), attributes, num(lib.rotation), "", lib.id, lib.side === "top" ? 1 : 2, "", "", 0, "", "yes", "", ""])
  return [head, ...lib.children].join(LIB_SEPARATOR)
}
