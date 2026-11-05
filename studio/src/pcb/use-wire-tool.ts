// The schematic's W wire tool: what is under the pointer, the wire being drawn, its keys and the
// wires waiting for their build.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import type { Design, Edit } from "../api"
import type { Actions } from "../App"
import { isCanvasKey } from "./canvas-common"
import { rightAngles, snap, type Camera, type Point } from "./geometry"
import { endAt, freePin, namedNetsJoined, pinAt, wireEdits, type WireEnd } from "./wire-tool"

/** A wire being drawn: where it starts, the pin it starts on if any, and the corners clicked so far, on the grid. */
export interface Drawing {
  start: WireEnd
  pin?: string
  corners: Point[]
}

/** What is under the pointer: the end a wire would use there, and the pin, if it is a pin. */
export interface Under {
  end?: WireEnd
  pin?: string
}

export interface WireInput {
  design: Design
  actions: Actions
  camera: Camera | undefined
  cursor: Point | undefined
  step: number
  /** Changes when a build finishes; pins may have moved. */
  buildId: string | undefined
  /** When the build behind the shown design started (ms). */
  builtFrom: number
}

interface PendingWire {
  points: Point[]
  sentAt: number
}

type WirePlan = { edits: Edit[]; points: Point[]; summary: string } | { notice?: string }

const PORT_HIT_PX = 12
const round = (value: number) => Math.round(value * 1000) / 1000
const sameUnder = (a: Under, b: Under) =>
  a.pin === b.pin && a.end?.selector === b.end?.selector && a.end?.at.x === b.end?.at.x && a.end?.at.y === b.end?.at.y

/** The edit for a wire from the drawing to `target`, or what to tell the person instead. */
function planWire(design: Design, drawing: Drawing, target: WireEnd): WirePlan {
  const { start, corners } = drawing
  if (target.selector === start.selector) return {}
  const repeated = [start, target].find((end) => end.selector.split(".")[0]?.includes("~"))
  if (repeated) return { notice: `${repeated.label} has a repeated name and cannot be wired from the Studio` }
  const edits = wireEdits(design, start, target, corners)
  if (edits.length === 0) return { notice: `${start.label} and ${target.label} are already connected` }
  const nets = namedNetsJoined(design, start, target)
  if (nets && !window.confirm(`This wire joins ${nets[0]} and ${nets[1]} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) {
    return {}
  }
  return { edits, points: rightAngles([start.at, ...corners, target.at]), summary: `connect ${start.label} to ${target.label}` }
}

/** What is under the pointer, kept as the same object while it does not change so the sheet is not redrawn; reset by each build. */
function useUnder(buildId: string | undefined) {
  const [under, setState] = useState<Under>({})
  const underRef = useRef<Under>({})
  const setUnder = useCallback((next: Under) => {
    underRef.current = next
    setState((current) => (sameUnder(current, next) ? current : next))
  }, [])
  useEffect(() => setUnder({}), [buildId, setUnder])
  return { under, setUnder, underRef }
}

/** Wires sent and drawn dashed until a build that started after each was sent has finished. */
function usePendingWires(builtFrom: number) {
  const [wires, setWires] = useState<PendingWire[]>([])
  useEffect(() => setWires((list) => (list.every((w) => w.sentAt > builtFrom) ? list : list.filter((w) => w.sentAt > builtFrom))), [builtFrom])
  const visible = useMemo(() => wires.filter((w) => w.sentAt > builtFrom).map((w) => w.points), [wires, builtFrom])
  const add = (points: Point[]): PendingWire => {
    const wire = { points, sentAt: Date.now() }
    setWires((list) => [...list, wire])
    return wire
  }
  const drop = (wire: PendingWire) => setWires((list) => list.filter((w) => w !== wire))
  return { visible, add, drop }
}

/** W starts a wire at the pin under the pointer, or turns wiring on and off; Esc cancels; Backspace removes a corner. */
function useWireKeys(
  drawing: Drawing | null,
  setDrawing: Dispatch<SetStateAction<Drawing | null>>,
  setWiring: Dispatch<SetStateAction<boolean>>,
  underRef: MutableRefObject<Under>,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCanvasKey(event)) return
      if (event.key === "Escape") return drawing ? setDrawing(null) : setWiring(false)
      if (event.key === "Backspace" && drawing) {
        event.preventDefault()
        return setDrawing({ ...drawing, corners: drawing.corners.slice(0, -1) })
      }
      if ((event.key !== "w" && event.key !== "W") || drawing) return
      const { end, pin } = underRef.current
      if (end) return setDrawing({ start: end, ...(pin ? { pin } : {}), corners: [] })
      setWiring((on) => !on)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drawing, setDrawing, setWiring, underRef])
}

/** The wire being drawn as it would run to the pointer: to the end under it, else to the grid point under it. */
function usePreview(drawing: Drawing | null, under: Under, cursor: Point | undefined, step: number): Point[] | undefined {
  return useMemo(() => {
    const to = under.end?.at ?? (cursor && { x: round(snap(cursor.x, step)), y: round(snap(cursor.y, step)) })
    return drawing && to ? rightAngles([drawing.start.at, ...drawing.corners, to]) : undefined
  }, [drawing, under, cursor, step])
}

/**
 * Wires are drawn the way KiCad users expect: click a free pin, or press W over any pin, then click
 * a pin, a net label or a wire to connect; clicks on the sheet place corners; Esc or a right click cancels.
 */
export function useWireTool(input: WireInput) {
  const { design, actions, camera, step } = input
  const [wiring, setWiring] = useState(false)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const { under, setUnder, underRef } = useUnder(input.buildId)
  const pending = usePendingWires(input.builtFrom)
  useWireKeys(drawing, setDrawing, setWiring, underRef)
  const preview = usePreview(drawing, under, input.cursor, step)
  const activePins = useMemo(() => [drawing?.pin, under.pin].filter((id): id is string => id !== undefined), [drawing, under])

  /** Any pin, label or wire while wiring or drawing, else only a pin. */
  const underAt = (world: Point): Under => {
    if (!camera) return {}
    const reach = PORT_HIT_PX / camera.scale
    const pin = pinAt(design, world, reach)?.pin
    if (!wiring && !drawing && !pin) return {}
    const end = endAt(design, world, reach)
    return { ...(end ? { end } : {}), ...(pin ? { pin } : {}) }
  }
  const finish = (current: Drawing, target: WireEnd) => {
    setDrawing(null)
    const plan = planWire(design, current, target)
    if (!("edits" in plan)) return plan.notice && actions.notify(plan.notice)
    const sent = pending.add(plan.points)
    void actions.edit(plan.edits, plan.summary).then((ok) => ok || pending.drop(sent))
  }
  const press = (event: { button: number; shiftKey: boolean }, world: Point) =>
    pressWire({ design, camera, wiring, drawing, setDrawing, step, finish, underAt }, event, world)
  const overPin = under.end !== undefined && (wiring || drawing !== null || (under.pin !== undefined && freePin(design, under.pin)))
  return {
    wiring,
    toggleWiring: () => {
      setWiring(!wiring)
      setDrawing(null)
    },
    drawing,
    under,
    pendingWires: pending.visible,
    preview,
    activePins,
    overPin,
    press,
    hover: (world: Point) => setUnder(underAt(world)),
    leave: () => setUnder({}),
  }
}

interface PressContext {
  design: Design
  camera: Camera | undefined
  wiring: boolean
  drawing: Drawing | null
  setDrawing(drawing: Drawing | null): void
  step: number
  finish(drawing: Drawing, target: WireEnd): void
  underAt(world: Point): Under
}

/** Handles a press for the wire tool; false when the press is not the wire tool's, so the canvas can pan or drag. */
function pressWire(c: PressContext, event: { button: number; shiftKey: boolean }, world: Point): boolean {
  if (!c.camera) return false
  if (event.button === 2 && c.drawing) {
    c.setDrawing(null)
    return true
  }
  if (event.button === 1 || event.button === 2 || event.shiftKey) return false
  if (c.drawing) {
    const target = endAt(c.design, world, PORT_HIT_PX / c.camera.scale)
    if (target) c.finish(c.drawing, target)
    else addCorner(c.drawing, world, c.step, c.setDrawing)
    return true
  }
  const { end, pin } = c.underAt(world)
  if (!end || (!c.wiring && !(pin && freePin(c.design, pin)))) return false
  c.setDrawing({ start: end, ...(pin ? { pin } : {}), corners: [] })
  return true
}

/** A click on empty sheet places a corner on the grid. */
function addCorner(drawing: Drawing, world: Point, step: number, setDrawing: (drawing: Drawing) => void): void {
  const corner = { x: round(snap(world.x, step)), y: round(snap(world.y, step)) }
  const last = drawing.corners[drawing.corners.length - 1] ?? drawing.start.at
  if (corner.x !== last.x || corner.y !== last.y) setDrawing({ ...drawing, corners: [...drawing.corners, corner] })
}
