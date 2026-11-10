import type { Point } from "./model.js"

/**
 * Rounded track corners, kept as points. A fillet replaces a corner by a run of short chords on the arc tangent to
 * both legs; straighten finds such runs by their shape alone (equal chords, equal turns, a half turn where each leg
 * meets the arc, equal tangent lengths) and puts the corner back where the two legs meet. Pure geometry, in mm.
 * The shape alone cannot tell a one-chord arc from a symmetric bend drawn by hand: two segments meeting at the same
 * small turn (at most 15 degrees) on equal tangents read as a rounded corner, and straighten makes them one corner.
 */

/** The widest angle one chord may span. */
export const MAX_CHORD_STEP = Math.PI / 12
/** The widest gap allowed between a chord's middle and the arc. */
export const MAX_CHORD_SAG = 0.005
/** A corner keeps at least this much of each leg straight, so the legs that frame its arc are still there to find. */
const MIN_STRAIGHT = 0.01
/** Turns closer than this (radians) count as equal; a turn smaller than it is no corner. */
const ANGLE_TOLERANCE = 1e-3
/**
 * Fillet leaves a corner alone when its arc's chords would turn by no more than twice that at each end: straighten
 * would not find such a run again (the nanometre rounding of very short chords moves their turns by up to the
 * tolerance), so neither command touches a corner that slight.
 */
const SLIGHTEST_HALF_STEP = 2 * ANGLE_TOLERANCE
/** Lengths closer than this (mm) count as equal, besides a relative allowance. */
const LENGTH_TOLERANCE = 1e-4
const LENGTH_SHARE = 0.01
/** New points are written to the nanometre. */
const NANOMETRE = 1e6

export interface SquareCorner {
  /** The corner's index in the points given. */
  index: number
  at: Point
  /** Why it stays square: "too short", or the guard's answer, such as "too close to GND". */
  reason: string
}

export interface FilletResult {
  points: Point[]
  /** The corners rounded now. */
  rounded: number
  /** The square corners that stay square, each with the reason. */
  square: SquareCorner[]
}

/**
 * Asked about each corner before it changes, with the corner point and its arc's points (the arc fillet would put in,
 * or the one straighten would take out): a reason when the corner may not change so.
 */
export type CornerGuard = (corner: Point, arc: readonly Point[]) => string | undefined

export interface StraightenResult {
  points: Point[]
  /** The corners put back now. */
  straightened: number
  /** The rounded corners that stay round, each at its corner point with the guard's reason. */
  round: { at: Point; reason: string }[]
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const length = (a: Point): number => Math.hypot(a.x, a.y)
const unit = (a: Point): Point => scale(a, 1 / length(a))
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const rounded = (p: Point): Point => ({ x: Math.round(p.x * NANOMETRE) / NANOMETRE, y: Math.round(p.y * NANOMETRE) / NANOMETRE })
const sameLength = (a: number, b: number): boolean => Math.abs(a - b) <= LENGTH_TOLERANCE + LENGTH_SHARE * Math.max(a, b)
const sameAngle = (a: number, b: number): boolean => Math.abs(a - b) <= ANGLE_TOLERANCE

/** The angle one chord of an arc of `radius` may span: at most 15 degrees, and at most what keeps it within 0.005 mm. */
export function chordStep(radius: number): number {
  const bySag = radius <= MAX_CHORD_SAG / 2 ? Math.PI : 2 * Math.acos(1 - MAX_CHORD_SAG / radius)
  return Math.min(MAX_CHORD_STEP, bySag)
}

/** The points without repeats: a zero-length segment has no direction. */
function distinct(points: readonly Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y)
}

/** The signed turn at each inner point (left is positive), indexed by point; the ends have none. */
function turns(points: readonly Point[]): number[] {
  return points.map((p, i) => {
    const [before, after] = [points[i - 1], points[i + 1]]
    if (before === undefined || after === undefined) return 0
    const [a, b] = [sub(p, before), sub(after, p)]
    return Math.atan2(cross(a, b), dot(a, b))
  })
}

/** Where the lines through a→b and c→d meet, if they are not parallel. */
function meeting(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const [r, s] = [sub(b, a), sub(d, c)]
  const denominator = cross(r, s)
  if (Math.abs(denominator) < 1e-12) return undefined
  return add(a, scale(r, cross(sub(c, a), s) / denominator))
}

/** A run of chords: points `first` to `last` lie on the arc, framed by the segments before `first` and after `last`. */
interface ChordRun {
  first: number
  last: number
  /** Where the framing legs meet: the corner the arc rounds. */
  corner: Point
}

/** The run starting at `first` (a half turn), or undefined when the points there are no arc. */
function runAt(points: readonly Point[], turn: readonly number[], first: number): ChordRun | undefined {
  const half = turn[first] as number
  if (Math.abs(half) <= ANGLE_TOLERANCE || Math.abs(half) > MAX_CHORD_STEP / 2 + ANGLE_TOLERANCE) return undefined
  let last = first + 1
  while (last < points.length - 1 && sameAngle(turn[last] as number, 2 * half)) last++
  if (last >= points.length - 1 || !sameAngle(turn[last] as number, half)) return undefined
  const chord = length(sub(points[first + 1] as Point, points[first] as Point))
  for (let i = first + 1; i < last; i++) if (!sameLength(length(sub(points[i + 1] as Point, points[i] as Point)), chord)) return undefined
  const [start, end] = [points[first] as Point, points[last] as Point]
  const corner = meeting(points[first - 1] as Point, start, end, points[last + 1] as Point)
  if (corner === undefined) return undefined
  const [inward, outward] = [sub(corner, start), sub(end, corner)]
  const ahead = dot(inward, sub(start, points[first - 1] as Point)) > 0 && dot(outward, sub(points[last + 1] as Point, end)) > 0
  return ahead && sameLength(length(inward), length(outward)) ? { first, last, corner } : undefined
}

/** Every chord run of a track, in order; runs never overlap. */
function chordRuns(points: readonly Point[]): ChordRun[] {
  const turn = turns(points)
  const runs: ChordRun[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const run = runAt(points, turn, i)
    if (!run) continue
    runs.push(run)
    i = run.last
  }
  return runs
}

/** How many chords the arc of `radius` over `angle` takes. */
const chordCount = (angle: number, radius: number): number => Math.max(1, Math.ceil(angle / chordStep(radius) - 1e-9))

/** The chords of the arc of `radius` that rounds the corner at `p`, from the incoming leg's tangent point to the outgoing one's. */
function arcPoints(p: Point, into: Point, out: Point, radius: number, turn: number): Point[] {
  const angle = Math.abs(turn)
  const tangent = radius * Math.tan(angle / 2)
  const [start, end] = [sub(p, scale(into, tangent)), add(p, scale(out, tangent))]
  const side = Math.sign(turn)
  const centre = add(start, scale({ x: -into.y * side, y: into.x * side }, radius))
  const count = chordCount(angle, radius)
  const from = sub(start, centre)
  const inner = Array.from({ length: count - 1 }, (_, k) => {
    const a = (side * angle * (k + 1)) / count
    return add(centre, { x: from.x * Math.cos(a) - from.y * Math.sin(a), y: from.x * Math.sin(a) + from.y * Math.cos(a) })
  })
  return [start, ...inner, end].map(rounded)
}

/**
 * Rounds every square corner of a track with an arc of `radius` (raised to the track's `width` when smaller), as chords.
 * A corner whose legs are too short for the arc (each keeps a little straight; a leg between two corners goes to the
 * first that needs it) or that the guard refuses stays square, with the reason. Corners rounded already stay as they are.
 */
export function filletTrack(points: readonly Point[], radius: number, width: number, guard?: CornerGuard): FilletResult {
  const path = distinct(points)
  const r = Math.max(radius, width)
  const turn = turns(path)
  const inRun = new Set(chordRuns(path).flatMap((run) => Array.from({ length: run.last - run.first + 1 }, (_, k) => run.first + k)))
  const out: Point[] = [path[0] as Point]
  const square: SquareCorner[] = []
  let count = 0
  for (let i = 1; i < path.length - 1; i++) {
    const [p, before, after] = [path[i] as Point, out.at(-1) as Point, path[i + 1] as Point]
    const angle = Math.abs(turn[i] as number)
    if (inRun.has(i) || angle / chordCount(angle, r) / 2 <= SLIGHTEST_HALF_STEP) {
      out.push(p)
      continue
    }
    const tangent = r * Math.tan(angle / 2)
    const fits = angle < Math.PI - ANGLE_TOLERANCE && tangent + MIN_STRAIGHT <= length(sub(p, before)) && tangent + MIN_STRAIGHT <= length(sub(after, p))
    const arc = fits ? arcPoints(p, unit(sub(p, path[i - 1] as Point)), unit(sub(after, p)), r, turn[i] as number) : undefined
    const reason = arc ? guard?.(p, arc) : "too short"
    if (arc && reason === undefined) {
      out.push(...arc)
      count++
      continue
    }
    square.push({ index: points.indexOf(p), at: p, reason: reason ?? "too short" })
    out.push(p)
  }
  if (path.length > 1) out.push(path.at(-1) as Point)
  return { points: count === 0 ? [...points] : out, rounded: count, square }
}

/**
 * Puts back every rounded corner of a track: each chord run becomes the point where its framing legs meet, unless the
 * guard refuses; a refused corner stays round, with the reason.
 */
export function straightenTrack(points: readonly Point[], guard?: CornerGuard): StraightenResult {
  const path = distinct(points)
  const round: StraightenResult["round"] = []
  const runs = chordRuns(path).filter((run) => {
    const corner = rounded(run.corner)
    const reason = guard?.(corner, path.slice(run.first, run.last + 1))
    return reason === undefined ? true : void round.push({ at: corner, reason })
  })
  if (runs.length === 0) return { points: [...points], straightened: 0, round }
  const out: Point[] = []
  let next = 0
  for (const run of runs) {
    out.push(...path.slice(next, run.first), rounded(run.corner))
    next = run.last + 1
  }
  out.push(...path.slice(next))
  return { points: out, straightened: runs.length, round }
}
