import ClipperLib from "clipper-lib"
import type { Point } from "../model.js"

/**
 * Polygon booleans and offsets on clipper-lib. Coordinates are whole micrometres (rounded once, on the way in), so
 * every operation is exact and the same input always gives the same output. Areas are filled by the non-zero rule;
 * results are strictly simple (no self-touching outlines), outers counter-clockwise and holes clockwise (y up).
 */
export type Path = ClipperLib.Path
export type Paths = ClipperLib.Paths

/** One piece of filled area: an outline and the holes in it. */
export interface Region {
  outer: Path
  holes: Path[]
}

export const UNITS_PER_MM = 1000
/** How far a round offset's corners may fall inside the true arc, in units (2 µm). */
export const ARC_TOLERANCE = 2
const MITER_LIMIT = 2

const toUnits = (mm: number) => Math.round(mm * UNITS_PER_MM)

export const toPath = (points: readonly Point[]): Path => points.map((p) => ({ X: toUnits(p.x), Y: toUnits(p.y) }))
export const toPoints = (path: Path): Point[] => path.map((p) => ({ x: p.X / UNITS_PER_MM, y: p.Y / UNITS_PER_MM }))

function clipper(subject: Paths, clip: Paths): ClipperLib.Clipper {
  const engine = new ClipperLib.Clipper()
  engine.StrictlySimple = true
  engine.AddPaths(subject.filter((path) => path.length >= 3), ClipperLib.PolyType.ptSubject, true)
  engine.AddPaths(clip.filter((path) => path.length >= 3), ClipperLib.PolyType.ptClip, true)
  return engine
}

function run(type: number, subject: Paths, clip: Paths): Paths {
  const out: Paths = []
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper(subject, clip).Execute(type, out, fill, fill)
  return out
}

/** Everything the paths cover. */
export const union = (paths: Paths): Paths => run(ClipperLib.ClipType.ctUnion, paths, [])
/** What `a` covers outside `b`. */
export const difference = (a: Paths, b: Paths): Paths => run(ClipperLib.ClipType.ctDifference, a, b)
/** What both cover. */
export const intersection = (a: Paths, b: Paths): Paths => run(ClipperLib.ClipType.ctIntersection, a, b)

/** The area grown (or shrunk, for a negative `mm`) by `mm`; miter keeps straight corners square, round rounds them. */
export function offset(paths: Paths, mm: number, join: "miter" | "round"): Paths {
  const kept = paths.filter((path) => path.length >= 3)
  if (kept.length === 0) return []
  const engine = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE)
  engine.AddPaths(kept, join === "miter" ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const out: Paths = []
  engine.Execute(out, mm * UNITS_PER_MM)
  return union(out)
}

/** The area as separate pieces, each an outline with its holes; an outline inside a hole is a piece of its own. */
export function regions(paths: Paths): Region[] {
  const tree = new ClipperLib.PolyTree()
  const fill = ClipperLib.PolyFillType.pftNonZero
  clipper(paths, []).Execute(ClipperLib.ClipType.ctUnion, tree, fill, fill)
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map((piece) => ({ outer: piece.outer, holes: piece.holes }))
}

/** The signed area in square units: positive for a counter-clockwise outline. */
export const pathArea = (path: Path): number => ClipperLib.Clipper.Area(path)

/** The area of a region in square units: its outline less its holes. */
export const regionArea = (region: Region): number => Math.abs(pathArea(region.outer)) - region.holes.reduce((sum, hole) => sum + Math.abs(pathArea(hole)), 0)

/** True when the point is inside the region or on its edge. */
export function regionHolds(region: Region, point: ClipperLib.IntPoint): boolean {
  if (ClipperLib.Clipper.PointInPolygon(point, region.outer) === 0) return false
  return region.holes.every((hole) => ClipperLib.Clipper.PointInPolygon(point, hole) !== 1)
}

/** The paths with points closer than `units` to their neighbours (or nearly in line with them) merged away. */
export const clean = (paths: Paths, units: number): Paths => ClipperLib.Clipper.CleanPolygons(paths, units)
