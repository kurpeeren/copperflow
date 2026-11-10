import type { LayoutEdit } from "../../core/layout-records.js"
import { shapeDistance, type Shape } from "../checks/geometry.js"
import type { Point } from "../model.js"
import type { WorldPad } from "../pcb.js"
import { offenders } from "./clear.js"
import { copperObstacles } from "./congestion.js"
import { classLookup, netRule, type RouteInput } from "./connect.js"
import { grow, routerWorld, type NetRule, type RouterWorld } from "./grid.js"
import { boxOf, type Obstacle } from "./obstacles.js"
import type { RoutedCopper, RoutedTrack } from "./path.js"
import type { RoutedConnection } from "./route-board.js"

/**
 * Cleanup after routing: track ends inside their pad snapped to its centre, vias removed where the same path fits on
 * one layer, points on a straight line dropped, and corners and staircases cut short by straight or 45° runs. Every
 * change is checked exactly against the board and the other routes (the check the grid stands in for) and is made
 * only when it is clear, so cleanup never creates a violation. A route's two ends stay where they are. The passes
 * repeat until nothing changes, so cleaning a cleaned result changes nothing.
 */

const EPS = 1e-6
/** The most passes over the routes; each change shortens a route, so they settle well before. */
const MAX_ROUNDS = 8
/** How far around a route other copper is gathered for its checks, in mm (beyond the route's own box). */
const NEAR_MM = 5

const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const lengthOf = (points: readonly Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y), 0)

/** Whether a to b runs straight across, down or at 45°. */
function octilinear(a: Point, b: Point): boolean {
  const [dx, dy] = [Math.abs(b.x - a.x), Math.abs(b.y - a.y)]
  return dx < EPS || dy < EPS || Math.abs(dx - dy) < EPS
}

/** Repeated points and points on the straight line between their neighbours dropped: the copper covers the same ground. */
function straightened(points: readonly Point[]): Point[] {
  const kept: Point[] = []
  for (const p of points) {
    const last = kept.at(-1)
    if (last !== undefined && same(last, p)) continue
    const before = kept.at(-2)
    if (before !== undefined && last !== undefined && Math.abs((last.x - before.x) * (p.y - before.y) - (last.y - before.y) * (p.x - before.x)) < EPS * EPS) kept.pop()
    kept.push(p)
  }
  return kept
}

/** The ways from a to b in at most two straight or 45° runs: direct, or 45° first, or 45° last. */
function bends(a: Point, b: Point): Point[][] {
  if (octilinear(a, b)) return [[]]
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const d = Math.min(Math.abs(dx), Math.abs(dy))
  const [sx, sy] = [Math.sign(dx) * d, Math.sign(dy) * d]
  return [[{ x: toNanometre(a.x + sx), y: toNanometre(a.y + sy) }], [{ x: toNanometre(b.x - sx), y: toNanometre(b.y - sy) }]]
}

/** What one route's changes are checked with: the board, its net's rule and the other routes' copper near it. */
interface Check {
  world: RouterWorld
  rule: NetRule
  extra: readonly Obstacle[]
}

const segments = (points: readonly Point[], width: number): Shape[] => points.slice(1).map((p, i) => ({ core: [points[i] as Point, p], radius: width / 2 }))

/** Whether a track through the points on the layer keeps every rule. */
const clear = (check: Check, layer: RoutedTrack["layer"], width: number, points: readonly Point[]) =>
  points.length < 2 || offenders(check.world, check.rule, { kind: "track", layers: [layer], shapes: segments(points, width) }, check.extra).length === 0

/** The track with corners and staircases cut short where a shorter straight or 45° way is clear. */
function smoothed(check: Check, track: RoutedTrack): RoutedTrack {
  let points = straightened(track.points)
  for (let i = 0; i < points.length - 2; i++) {
    for (let j = points.length - 1; j >= i + 2; j--) {
      const [a, b] = [points[i] as Point, points[j] as Point]
      const before = lengthOf(points.slice(i, j + 1))
      const way = bends(a, b)
        .map((middle) => [a, ...middle, b])
        .find((candidate) => lengthOf(candidate) < before - EPS && clear(check, track.layer, track.width, candidate))
      if (way === undefined) continue
      points = straightened([...points.slice(0, i), ...way, ...points.slice(j + 1)])
      break
    }
  }
  return { ...track, points }
}

/** The copper on one layer without its vias, when its ends are on that layer, not on a via, and the path is clear there. */
function withoutVias(check: Check, copper: RoutedCopper): RoutedCopper {
  const [first, last] = [copper.tracks[0], copper.tracks.at(-1)]
  if (copper.vias.length === 0 || first === undefined || last === undefined || first.layer !== last.layer) return copper
  const [start, end] = [first.points[0] as Point, last.points.at(-1) as Point]
  if (copper.vias.some((via) => same(via.at, start) || same(via.at, end))) return copper
  const points = straightened(copper.tracks.flatMap((track) => track.points))
  if (!clear(check, first.layer, first.width, points)) return copper
  return { net: copper.net, tracks: [{ layer: first.layer, width: first.width, points }], vias: [] }
}

/** A pad of the route, its shapes and layers, for snapping. */
interface EndPad {
  pad: WorldPad
  shapes: readonly Shape[]
}

const onLayer = (pad: WorldPad, layer: RoutedTrack["layer"]) => pad.layers === "through" || pad.layers === layer
const inside = (end: EndPad, p: Point) => end.shapes.some((shape) => shapeDistance({ core: [p], radius: 0 }, shape) <= EPS)

/** The track with its end at `p` led on to the centre of a pad of the route the end lies inside, when that is clear. */
function snappedEnd(check: Check, track: RoutedTrack, pads: readonly EndPad[], atStart: boolean): RoutedTrack {
  const p = (atStart ? track.points[0] : track.points.at(-1)) as Point
  const end = pads.find((one) => onLayer(one.pad, track.layer) && inside(one, p) && !same(p, one.pad))
  if (end === undefined) return track
  const centre = { x: end.pad.x, y: end.pad.y }
  if (!clear(check, track.layer, track.width, [centre, p])) return track
  return { ...track, points: straightened(atStart ? [centre, ...track.points] : [...track.points, centre]) }
}

function snapped(check: Check, copper: RoutedCopper, pads: readonly EndPad[]): RoutedCopper {
  const tracks = [...copper.tracks]
  if (tracks.length === 0) return copper
  tracks[0] = snappedEnd(check, tracks[0] as RoutedTrack, pads, true)
  tracks[tracks.length - 1] = snappedEnd(check, tracks[tracks.length - 1] as RoutedTrack, pads, false)
  return { ...copper, tracks }
}

/** One route cleaned once: ends snapped, vias removed, then each track smoothed. */
function cleanedOnce(check: Check, copper: RoutedCopper, pads: readonly EndPad[]): RoutedCopper {
  const merged = withoutVias(check, snapped(check, copper, pads))
  return { ...merged, tracks: merged.tracks.map((track) => smoothed(check, track)) }
}

const overlaps = (a: Obstacle["box"], b: Obstacle["box"]) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

/** The routes cleaned up (see the module comment), in the same order; `world` may be given to save building it again. */
export function cleanup(input: RouteInput, routed: readonly RoutedConnection[], world?: RouterWorld): RoutedConnection[] {
  const board = world ?? routerWorld(input.layout, input.rules, classLookup(input.rules, input.nets))
  const pads = new Map(input.layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const padShapes = new Map(board.obstacles.filter((piece) => piece.kind === "pad").map((piece) => [piece.id, piece.shapes]))
  const rules = new Map<string, NetRule>()
  const ruleOf = (net: string) => rules.get(net) ?? rules.set(net, netRule(input.rules, input.nets, net)).get(net)!
  const coppers = routed.map((route) => route.copper)
  const pieces = coppers.map((copper) => copperObstacles(copper, ruleOf(copper.net).className))
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false
    routed.forEach((route, k) => {
      const copper = coppers[k] as RoutedCopper
      const mine = pieces[k] as Obstacle[]
      const box = grow(mine.length > 0 ? boxOf(mine.flatMap((piece) => piece.shapes)) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }, NEAR_MM)
      const extra = pieces.flatMap((others, i) => (i === k ? [] : others.filter((piece) => overlaps(piece.box, box))))
      const ends = [route.from, route.to].flatMap((id) => {
        const pad = pads.get(id)
        return pad === undefined ? [] : [{ pad, shapes: padShapes.get(id) ?? [] }]
      })
      const next = cleanedOnce({ world: board, rule: ruleOf(copper.net), extra }, copper, ends)
      if (JSON.stringify(next) === JSON.stringify(copper)) return
      changed = true
      coppers[k] = next
      pieces[k] = copperObstacles(next, ruleOf(next.net).className)
    })
    if (!changed) break
  }
  return routed.map((route, k) => ({ ...route, copper: coppers[k] as RoutedCopper }))
}

/** The routes as layout edits in one list: each route's tracks, then its vias. Applied with the router's mark, they read `by: "router"`. */
export function layoutEdits(routed: readonly RoutedConnection[]): LayoutEdit[] {
  return routed.flatMap(({ copper }): LayoutEdit[] => [
    ...copper.tracks.map((track): LayoutEdit => ({ kind: "addTrack", net: copper.net, layer: track.layer, width: track.width, points: track.points.map((p) => ({ x: p.x, y: p.y })) })),
    ...copper.vias.map((via): LayoutEdit => ({ kind: "addVia", net: copper.net, at: { x: via.at.x, y: via.at.y }, drill: via.drill, diameter: via.diameter, layers: [...via.layers] })),
  ])
}
