// The PCB's track tool as pure data (Route → Single routing, Route → Via): a route starts on a pad, on its net and
// layer; clicks add corners, each leg in the corner mode it was clicked with (track-corners.ts); V changes the layer
// at the last corner, which then holds a via; Backspace takes the last corner back (and its via); a click on a pad, a
// track or a via of the same net finishes it, as one list of layout edits (one history entry). Plain TypeScript with
// .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import type { CopperLayer } from "../../../src/core/layout-file.js"
import { DEFAULT_CLASS } from "../../../src/engine/rules/profiles.js"
import { snapPosition, type Point } from "./geometry.js"
import { nextCornerMode, routePoints, type CornerMode } from "./track-corners.js"
import type { RouteNet } from "./track-rules.js"

/** The two copper layers a route runs on (inner layers are not drawn yet). */
export type RouteLayer = "top" | "bottom"

const LAYER_NAMES: Readonly<Record<CopperLayer, string>> = { top: "Top Layer", bottom: "Bottom Layer", inner1: "Inner Layer 1", inner2: "Inner Layer 2" }
export const layerName = (layer: CopperLayer): string => LAYER_NAMES[layer]
export const otherLayer = (layer: RouteLayer): RouteLayer => (layer === "top" ? "bottom" : "top")

/** What is under the pointer for the tool: a pad, a track (met at `at`) or a via; `net` is the net id. */
export type RouteTarget =
  | { kind: "pad"; id: string; label: string; part: string; at: Point; net?: string; netName?: string; layer: "top" | "bottom" | "through" }
  | { kind: "track"; id: string; at: Point; net?: string; netName?: string; layer: CopperLayer }
  | { kind: "via"; id: string; at: Point; net?: string; netName?: string }

export interface RouteStart {
  label: string
  at: Point
  /** A through-hole pad is on both layers, so the layer may change before the first corner. */
  through: boolean
}

/** A clicked corner: the leg to it was clicked in `mode` and runs on `layer`. */
export interface RouteCorner {
  at: Point
  mode: CornerMode
  layer: RouteLayer
}

export interface Route {
  net: RouteNet
  start: RouteStart
  /** The layer of the leg to the pointer; where it differs from the last corner's, a via sits at that corner. */
  layer: RouteLayer
  /** The mode of the leg to the pointer. */
  mode: CornerMode
  corners: readonly RouteCorner[]
}

export interface StartContext {
  activeLayer: RouteLayer
  /** The locked parts: a track may not start on their pads (the core refuses it too: src/core/layout-locks.ts lockedStart). */
  locked: ReadonlySet<string>
  netOf(id: string): RouteNet | undefined
}

/** The copper a route (or a via) draws, before it is written and until its build lands. */
export interface RouteDrawing {
  tracks: { layer: RouteLayer; width: number; points: Point[] }[]
  vias: { at: Point; drill: number; diameter: number }[]
}

export type Message = { message: string }

/** Where a route may start, or why not: a pad, a track (at the meeting point) or a via, on a net. */
function startOf(target: RouteTarget, context: StartContext): { start: RouteStart; layer: RouteLayer } | Message {
  if (target.kind === "pad") {
    if (context.locked.has(target.part)) return { message: `${target.part} is locked: a track may not start on its pads. Unlock it first.` }
    const through = target.layer === "through"
    return { start: { label: target.label, at: target.at, through }, layer: target.layer === "through" ? context.activeLayer : target.layer }
  }
  const label = `${target.kind} ${target.id}`
  if (target.kind === "via") return { start: { label, at: target.at, through: true }, layer: context.activeLayer }
  if (target.layer !== "top" && target.layer !== "bottom") return { message: `${label} is on ${layerName(target.layer)}, which cannot be routed yet` }
  return { start: { label, at: target.at, through: false }, layer: target.layer }
}

/** A route from a pad, a track or a via, on its net (the net's width) and layer. */
export function startRoute(target: RouteTarget, context: StartContext): { route: Route } | Message {
  const net = target.net === undefined ? undefined : context.netOf(target.net)
  const name = target.kind === "pad" ? target.label : `${target.kind} ${target.id}`
  if (!net) return { message: `${name} is on no net; connect it in the schematic first` }
  const from = startOf(target, context)
  if ("message" in from) return from
  return { route: { net, start: from.start, layer: from.layer, mode: "45", corners: [] } }
}

/**
 * Where a click (or the pointer) puts the next corner: on the grid while Snap is on, but on the last point's x or y
 * when the pointer is within half a grid step of it, so a leg from an off-grid pad centre runs straight, with no jog.
 */
export function routeCorner(last: Point, world: Point, grid: { step: number; snap: boolean }): Point {
  if (!grid.snap) return world
  const axis = (a: "x" | "y") => (Math.abs(world[a] - last[a]) < grid.step / 2 ? last[a] : snapPosition(world[a], grid.step))
  return { x: axis("x"), y: axis("y") }
}

export const lastPoint = (route: Route): Point => route.corners.at(-1)?.at ?? route.start.at
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

export function addRouteCorner(route: Route, at: Point): Route {
  if (samePoint(at, lastPoint(route))) return route
  return { ...route, corners: [...route.corners, { at, mode: route.mode, layer: route.layer }] }
}

/** Space: the next corner mode for the leg to the pointer. */
export const nextRouteMode = (route: Route): Route => ({ ...route, mode: nextCornerMode(route.mode) })

/** V (or the Layer panel's select): the leg to the pointer goes to `next`, with a via at the last corner. */
export function switchRouteLayer(route: Route, next: RouteLayer = otherLayer(route.layer)): Route | Message {
  if (next === route.layer) return route
  if (route.corners.length === 0 && !route.start.through) {
    return { message: `${route.start.label} is on the ${layerName(route.layer)} only; click a corner before changing layer` }
  }
  return { ...route, layer: next }
}

/** Backspace: the last corner goes, and with it any via there; the leg to the pointer is back on that corner's layer. */
export function removeRouteCorner(route: Route): Route {
  const last = route.corners.at(-1)
  return last ? { ...route, corners: route.corners.slice(0, -1), layer: last.layer } : route
}

type Leg = RouteCorner

/** The route's tracks (one per run on a layer) and the vias where the layer changes, ending at `end`. */
export function routeDrawing(route: Route, end: Point): RouteDrawing {
  const legs: Leg[] = [...route.corners, { at: end, mode: route.mode, layer: route.layer }]
  const { width, via } = route.net
  const drawing: RouteDrawing = { tracks: [], vias: [] }
  let run = { layer: legs[0]?.layer ?? route.layer, from: route.start.at, legs: [] as Leg[] }
  let from = route.start.at
  const close = () => {
    const points = routePoints(run.from, run.legs.map((leg) => ({ to: leg.at, mode: leg.mode })))
    if (points.length >= 2) drawing.tracks.push({ layer: run.layer, width, points })
  }
  for (const leg of legs) {
    if (leg.layer !== run.layer) {
      close()
      drawing.vias.push({ at: from, ...via })
      run = { layer: leg.layer, from, legs: [] }
    }
    run.legs.push(leg)
    from = leg.at
  }
  close()
  return drawing
}

/**
 * The layout edits of a drawing, in path order: each track, then the via at its end. `vias[i]` sits at the end of
 * `tracks[i]` because no run but the last can be empty: addRouteCorner refuses a repeated point, so every run before
 * a layer change has a leg of its own (the last run, ended where its via is, is the only one dropped).
 */
export function drawingEdits(drawing: RouteDrawing, net: string | undefined): LayoutEdit[] {
  const named = net === undefined ? {} : { net }
  const at = (i: number): LayoutEdit[] => {
    const [track, via] = [drawing.tracks[i], drawing.vias[i]]
    return [
      ...(track ? [{ kind: "addTrack", ...named, layer: track.layer, width: track.width, points: track.points } as const] : []),
      ...(via ? [{ kind: "addVia", ...named, at: via.at, drill: via.drill, diameter: via.diameter, layers: ["top", "bottom"] } as LayoutEdit] : []),
    ]
  }
  return Array.from({ length: Math.max(drawing.tracks.length, drawing.vias.length) }, (_, i) => at(i)).flat()
}

/** Why the route may not end on `target`, if it may not. */
function refusal(route: Route, target: RouteTarget): string | undefined {
  const name = target.kind === "pad" ? target.label : target.kind === "track" ? `Track ${target.id}` : `Via ${target.id}`
  if (target.net !== route.net.id) return `${name} is on ${target.netName ?? "no net"}, but the track is on ${route.net.name}`
  const layer = target.kind === "via" ? "through" : target.layer
  if (layer !== "through" && layer !== route.layer) return `${name} is on the ${layerName(layer)}; press V to change layer first`
  return undefined
}

const targetName = (target: RouteTarget): string => (target.kind === "pad" ? target.label : `${target.kind} ${target.id}`)

export interface Finished {
  edits: LayoutEdit[]
  summary: string
  drawing: RouteDrawing
}

/** A click on `target` while routing: the edits that finish the route, why it cannot end there, or nothing (undefined). */
export function finishRoute(route: Route, target: RouteTarget): Finished | Message | undefined {
  if (route.corners.length === 0 && samePoint(target.at, route.start.at)) return undefined
  const why = refusal(route, target)
  if (why) return { message: why }
  const drawing = routeDrawing(route, target.at)
  return { edits: drawingEdits(drawing, route.net.name), summary: `Route ${route.net.name} from ${route.start.label} to ${targetName(target)}`, drawing }
}

/**
 * Route → Via at a click: on a pad at its centre and on a track at the meeting point, taking their net; on nothing at
 * the grid point `snapped`, with no net and the `fallback` size; refused on a via.
 */
export function placeViaAt(
  target: RouteTarget | undefined,
  snapped: Point,
  netOf: (id: string) => RouteNet | undefined,
  fallback: RouteNet["via"] = DEFAULT_CLASS.via,
): Finished | Message {
  if (target?.kind === "via") return { message: `Via ${target.id} is already there` }
  const net = target?.net === undefined ? undefined : netOf(target.net)
  return viaPlacement(target ? target.at : snapped, net, fallback)
}

/** Route → Via: a via at `at` on the net under it (none when nothing is), sized by that net's class. */
export function viaPlacement(at: Point, net: RouteNet | undefined, fallback: RouteNet["via"] = DEFAULT_CLASS.via): Finished {
  const size = net?.via ?? fallback
  const drawing: RouteDrawing = { tracks: [], vias: [{ at, drill: size.drill, diameter: size.diameter }] }
  const where = `at (${at.x}, ${at.y})`
  return { edits: drawingEdits(drawing, net?.name), summary: net ? `Add via on ${net.name} ${where}` : `Add via ${where}`, drawing }
}
