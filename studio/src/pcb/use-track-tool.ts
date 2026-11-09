// The PCB's track tool (Route → Single routing, W or Alt+W) and Route → Via (Alt+V): the state, the keys, the press,
// the preview and the copper sent and waiting for its build. What each step does is in track-tool.ts; what is under the
// pointer, in track-targets.ts; the width, in track-rules.ts. A finished track (with its vias) is one layout edit,
// so one history entry, drawn solid at 70% until the build that reads it lands.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react"
import type { Design } from "../api"
import type { Actions } from "../App"
import type { PcbCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { CommandId } from "../shell/menus"
import { escapeDisarms, keyAction, keyInput } from "./canvas-keys"
import { PENDING_ROUTE_ALPHA } from "./copper-draw"
import { dropPending, markPending, settlePending } from "./copper-pending"
import { snapPoint, type Camera, type Point } from "./geometry"
import type { ActiveLayer, LayerVisibility } from "./layers"
import type { Press } from "./press"
import { routingStatus } from "./status"
import { routeNet } from "./track-rules"
import { routeTargetAt, type TargetSource } from "./track-targets"
import {
  addRouteCorner,
  finishRoute,
  layerName,
  nextRouteMode,
  otherLayer,
  removeRouteCorner,
  routeDrawing,
  startRoute,
  switchRouteLayer,
  viaPlacement,
  type Finished,
  type Route,
  type RouteDrawing,
  type RouteTarget,
} from "./track-tool"

/** Which of the two tools is armed. */
export type TrackArm = "route" | "via" | null

const TOOL_COMMAND: Readonly<Record<Exclude<TrackArm, null>, PcbCommand>> = { route: "singleRouting", via: "placeVia" }
/** How far from a pad, a track or a via a click still reaches it, in CSS pixels, as the wire tool reaches a pin. */
const TARGET_REACH_PX = 12

export interface TrackToolInput {
  design: Design
  builtMark: number | undefined
  /** The copper as shown (the design's, with edits waiting for their build), with each record's net id. */
  copper: TargetSource["copper"]
  camera: Camera | undefined
  cursor: Point | undefined
  step: number
  snap: boolean
  layers: LayerVisibility
  activeLayer: ActiveLayer
  onActiveLayer(layer: ActiveLayer): void
  /** The locked parts, whose pads a track may not start on. */
  locked: ReadonlySet<string>
  actions: Actions
  /** The armed tool, held by the canvas so the note tool can put it away (useTrackArm). */
  arm: ReturnType<typeof useTrackArm>
  /** Arming one of these tools puts the canvas's other tools away. */
  onArm(): void
}

/** The armed tool; its own hook, so the canvas's other tools can put it away before the track tool is made. */
export function useTrackArm() {
  const [armed, setArmed] = useState<TrackArm>(null)
  const disarm = useCallback(() => setArmed(null), [])
  return { armed, setArmed, disarm }
}

interface PendingRoute {
  id: number
  drawing: RouteDrawing
  mark?: number
}

/** Tracks and vias sent and drawn at 70% until the build that reads them is shown; a failed edit's go at once. */
function usePendingRoutes(builtMark: number | undefined, actions: Actions) {
  const [list, setList] = useState<readonly PendingRoute[]>([])
  const counter = useRef(0)
  useEffect(() => setList((current) => settlePending(current, builtMark)), [builtMark])
  const drawings = useMemo(() => settlePending(list, builtMark).map((entry) => ({ drawing: entry.drawing, alpha: PENDING_ROUTE_ALPHA })), [list, builtMark])
  const send = useCallback(
    (finished: Finished) => {
      counter.current += 1
      const id = counter.current
      setList((current) => [...current, { id, drawing: finished.drawing }])
      void actions.editLayout(finished.edits, finished.summary).then((outcome) =>
        setList((current) => (outcome.ok && outcome.mark !== undefined ? markPending(current, id, outcome.mark) : dropPending(current, id))),
      )
    },
    [actions],
  )
  return { drawings, send }
}

/** What the handlers read on each event: the latest input and route, and the steps they take. */
interface Latest {
  input: TrackToolInput
  route: Route | null
  setRoute: Dispatch<SetStateAction<Route | null>>
  /** Sets the route and keeps the active layer on its layer. */
  put(next: Route): void
  targetAt(world: Point): RouteTarget | undefined
  start(target: RouteTarget): void
  changeLayer(next: ActiveLayer): void
  arm(kind: Exclude<TrackArm, null>): void
}

function targetSource(input: TrackToolInput): TargetSource {
  return { design: input.design, copper: input.copper, visible: input.layers }
}

/** The steps the keys and the press share, read through `latest`. */
function useSteps(input: TrackToolInput, route: Route | null, setRoute: Dispatch<SetStateAction<Route | null>>): Latest {
  const { design, actions, onActiveLayer, arm: armState, onArm } = input
  const targetAt = (world: Point) =>
    input.camera ? routeTargetAt(targetSource(input), world, TARGET_REACH_PX / input.camera.scale, route?.layer ?? input.activeLayer, { step: input.step, snap: input.snap }) : undefined
  const put = (next: Route) => {
    setRoute(next)
    if (next.layer !== input.activeLayer) onActiveLayer(next.layer)
  }
  const start = (target: RouteTarget) => {
    const started = startRoute(target, { activeLayer: input.activeLayer, locked: input.locked, netOf: (id) => routeNet(design, id) })
    if ("message" in started) return actions.notify(started.message)
    put(started.route)
  }
  const changeLayer = (next: ActiveLayer) => {
    if (!route) return onActiveLayer(next)
    const switched = switchRouteLayer(route, next)
    if ("message" in switched) actions.notify(switched.message)
    put("message" in switched ? route : switched)
  }
  const arm = (kind: Exclude<TrackArm, null>) => {
    onArm()
    setRoute(null)
    armState.setArmed(kind)
  }
  return { input, route, setRoute, put, targetAt, start, changeLayer, arm }
}

/** W or Alt+W arms routing (and over a pad starts there), Alt+V the via; while routing Space, V, Backspace and Esc. */
function onTrackKey(latest: Latest, event: KeyboardEvent): void {
  const { input, route, setRoute } = latest
  const press = keyInput(event)
  const take = () => {
    event.preventDefault()
    event.stopPropagation()
  }
  if (escapeDisarms(press) && (route || input.arm.armed)) {
    take()
    return route ? setRoute(null) : input.arm.disarm()
  }
  const hit = keyAction(press, { view: "pcb", drawing: route !== null })
  if (!hit) return
  if (hit.action === "route" || hit.action === "placeVia") {
    if (hit.preventDefault) event.preventDefault()
    if (route) return
    latest.arm(hit.action === "route" ? "route" : "via")
    const under = hit.action === "route" && input.cursor ? latest.targetAt(input.cursor) : undefined
    if (under?.kind === "pad") latest.start(under)
    return
  }
  if (hit.action === "switchLayer") {
    take()
    return latest.changeLayer(otherLayer(route?.layer ?? input.activeLayer))
  }
  if (!route || (hit.action !== "flipBend" && hit.action !== "removeCorner")) return
  take()
  latest.put(hit.action === "flipBend" ? nextRouteMode(route) : removeRouteCorner(route))
}

/** The keys, taken before the part keys hear them (a capture listener that stops them). */
function useTrackKeys(latest: RefObject<Latest>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onTrackKey(latest.current, event)
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [latest])
}

/** Route → Via: a via at the grid point under the press, on the net of the pad or track there, if any. */
function placeVia(latest: Latest, world: Point, send: (finished: Finished) => void): void {
  const { input } = latest
  const at = snapPoint(world, input.step, input.snap)
  const under = routeTargetAt(targetSource(input), at, 0, undefined)
  const net = under?.net === undefined ? undefined : routeNet(input.design, under.net)
  send(viaPlacement(at, net))
}

/** A click while routing: a pad, track or via finishes the route (or says why it cannot), else a corner goes on the grid. */
function clickRoute(latest: Latest, world: Point, send: (finished: Finished) => void): void {
  const { input, route } = latest
  const target = latest.targetAt(world)
  if (!route) {
    if (target) latest.start(target)
    return
  }
  if (!target) return latest.put(addRouteCorner(route, snapPoint(world, input.step, input.snap)))
  const end = finishRoute(route, target)
  if (!end) return
  if ("message" in end) return input.actions.notify(end.message)
  latest.setRoute(null)
  send(end)
}

/** A press for the tools; false when it is not theirs (nothing armed, or the middle button), so the canvas pans or picks. */
function pressTrack(latest: Latest, event: Press, world: Point, send: (finished: Finished) => void): boolean {
  const { input, route } = latest
  if (!input.arm.armed || (event.button !== 0 && event.button !== 2)) return false
  // A right click drops the route, else puts the tool away, as Esc does.
  if (event.button === 2) {
    if (route) latest.setRoute(null)
    else input.arm.disarm()
  } else if (input.arm.armed === "via") placeVia(latest, world, send)
  else clickRoute(latest, world, send)
  return true
}

/** The route as it would run to the pointer: to what is under it, else to the grid point under it. */
function previewOf(latest: Latest, cursor: Point | undefined): RouteDrawing | undefined {
  const { route, input } = latest
  if (!route || !cursor) return undefined
  return routeDrawing(route, latest.targetAt(cursor)?.at ?? snapPoint(cursor, input.step, input.snap))
}

const hintOf = (armed: TrackArm, route: Route | null, active: ActiveLayer): string | undefined => {
  if (armed === "via") return "Via: click to place one; it takes the net of the pad or track under it. Esc to stop."
  return armed === "route" && !route ? `Single routing: click a pad to start a track on the ${layerName(active)}. Esc to stop.` : undefined
}

export function useTrackTool(input: TrackToolInput) {
  const [route, setRoute] = useState<Route | null>(null)
  const pending = usePendingRoutes(input.builtMark, input.actions)
  const steps = useSteps(input, route, setRoute)
  const latest = useRef(steps)
  latest.current = steps
  useTrackKeys(latest)
  useCommands({ singleRouting: () => latest.current.arm("route"), placeVia: () => latest.current.arm("via") } satisfies Record<PcbCommand, () => void>)
  const { armed } = input.arm
  // Putting the tool away drops the route; the Layer panel's select changes the route's layer as V does.
  useEffect(() => {
    if (armed !== "route") setRoute(null)
  }, [armed])
  useEffect(() => {
    if (route && route.layer !== input.activeLayer) latest.current.changeLayer(input.activeLayer)
  }, [route, input.activeLayer])
  const preview = previewOf(steps, input.cursor)
  const routes = preview ? [...pending.drawings, { drawing: preview, alpha: 1 }] : pending.drawings
  const command: CommandId | null = armed ? TOOL_COMMAND[armed] : null
  return {
    armed: armed !== null,
    routing: route !== null,
    command,
    routes,
    status: route ? routingStatus(route.net.name, layerName(route.layer), route.net.width) : undefined,
    hint: hintOf(armed, route, input.activeLayer),
    press: (event: Press, world: Point) => pressTrack(latest.current, event, world, pending.send),
  }
}
