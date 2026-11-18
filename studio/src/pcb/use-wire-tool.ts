// The schematic's W wire tool: what is under the pointer, the wire being drawn, its keys, the list of a bus's
// members a wire that meets a bus picks from, and the wires waiting for their build.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import type { Design, Edit } from "../api"
import type { Actions } from "../App"
import { isCanvasKey } from "./canvas-common"
import { keyAction, keyInput } from "./canvas-keys"
import { snapPoint, type Camera, type Point } from "./geometry"
import { wirePath } from "./wire-path"
import { endAt, freePin, memberEnd, type Meet, namedNetsJoined, pinAt, PIN_REACH_PX, portWire, sameEnd, wireEdits, type WireEnd } from "./wire-tool"
import { keepWireEnds, type KeepOptions } from "./wire-keeps-ends"

/**
 * A wire being drawn: where it starts, the pin it starts on if any, the corners clicked so far (on the grid)
 * and the bend each of their legs was clicked with, then the bend the leg to the pointer has now (`flip`).
 * A bend is true when the leg runs vertically first.
 */
export interface Drawing {
  start: WireEnd
  pin?: string
  corners: Point[]
  bends: boolean[]
  flip: boolean
}

const newDrawing = (start: WireEnd, pin: string | undefined, flip = false): Drawing => ({ start, ...(pin ? { pin } : {}), corners: [], bends: [], flip })

/** The bend of every leg, the last being the leg to the pointer. */
const legBends = (drawing: Drawing): boolean[] => [...drawing.bends, drawing.flip]

/** The wire as it is saved and drawn, from its start through the clicked corners to `to`. */
const drawnPath = (drawing: Drawing, to: Point): Point[] => wirePath([drawing.start.at, ...drawing.corners, to], legBends(drawing))

/**
 * A bus a wire meets, waiting for one of its members to be picked from the list: the wire then starts at that member
 * (`start`), or the wire being drawn ends there (`end`).
 */
export interface Picking {
  bus: WireEnd
  role: "start" | "end"
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
  /** Whether corners go to the grid (View → Snap). */
  snap: boolean
  /** Changes when a build finishes; pins may have moved. */
  buildId: string | undefined
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  /** What a wire's pinned ends may not change, and the source that keeps their turns (wire-keeps-ends.ts). */
  keep?: KeepOptions
}

interface PendingWire {
  points: Point[]
  sentAt: number
}

type WirePlan = { edits: Edit[]; points: Point[]; summary: string } | { notice?: string }

const PORT_HIT_PX = PIN_REACH_PX
const sameUnder = (a: Under, b: Under) =>
  a.pin === b.pin && a.end?.selector === b.end?.selector && a.end?.at.x === b.end?.at.x && a.end?.at.y === b.end?.at.y

/** The edit for a wire from the drawing to `target`, or what to tell the person instead. */
function planWire(design: Design, drawing: Drawing, target: WireEnd, keep: KeepOptions = {}): WirePlan {
  const { start, corners } = drawing
  if (sameEnd(target, start)) return {}
  const port = portWire(design, start, target)
  // A symbol's pin is connected through its instance's connections; the build then draws the wire.
  if (port) return "edits" in port ? { ...port, points: [] } : port
  const repeated = [start, target].find((end) => end.selector.split(".")[0]?.includes("~"))
  if (repeated) return { notice: `${repeated.label} has a repeated name and cannot be wired from the Studio` }
  const edits = wireEdits(design, start, target, corners, legBends(drawing))
  if (edits.length === 0) return { notice: `${start.label} and ${target.label} are already connected` }
  const nets = namedNetsJoined(design, start, target)
  if (nets && !window.confirm(`This wire joins ${nets[0]} and ${nets[1]} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) {
    return {}
  }
  // A hand-drawn wire pins the engine-placed parts at its ends where they are now, in the same edit.
  const kept = keepWireEnds(design, { edits, summary: `connect ${start.label} to ${target.label}` }, [start.selector, target.selector], keep)
  return { ...kept, points: drawnPath(drawing, target.at) }
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

interface WireKeys {
  drawing: Drawing | null
  setDrawing: Dispatch<SetStateAction<Drawing | null>>
  setWiring: Dispatch<SetStateAction<boolean>>
  underRef: MutableRefObject<Under>
  /** Starts a wire at the end under the pointer; a bus asks for its member first. */
  start(end: WireEnd, pin: string | undefined): void
  /** Esc: closes the member list, else drops the wire being drawn, else stops wiring. */
  escape(): void
}

/** W starts a wire at the pin (or bus) under the pointer, or turns wiring on and off; Esc cancels; Backspace removes a corner; Space flips the bend. */
function useWireKeys({ drawing, setDrawing, setWiring, underRef, start, escape }: WireKeys): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view: "schematic", drawing: drawing !== null })
      if (hit?.action === "wire") {
        if (hit.preventDefault) event.preventDefault()
        if (drawing) return
        const { end, pin } = underRef.current
        if (end) return start(end, pin)
        return setWiring((on) => !on)
      }
      // Backspace goes by the canvas key rule, so it does nothing in a field or on a focused table row or list.
      if (hit?.action === "removeCorner" && drawing) {
        event.preventDefault()
        return setDrawing({ ...drawing, corners: drawing.corners.slice(0, -1), bends: drawing.bends.slice(0, -1) })
      }
      // Space turns the leg to the pointer the other way round; the corners already clicked keep theirs.
      if (hit?.action === "flipBend" && drawing) {
        event.preventDefault()
        return setDrawing({ ...drawing, flip: !drawing.flip })
      }
      if (event.key === "Escape" && isCanvasKey(event)) escape()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drawing, setDrawing, setWiring, underRef, start, escape])
}

/** The wire being drawn as it would run to the pointer: to the end under it, else to the grid point under it. */
function usePreview(drawing: Drawing | null, under: Under, cursor: Point | undefined, step: number, snap: boolean): Point[] | undefined {
  return useMemo(() => {
    const to = under.end?.at ?? (cursor && snapPoint(cursor, step, snap))
    return drawing && to ? drawnPath(drawing, to) : undefined
  }, [drawing, under, cursor, step, snap])
}

/** How a wire meets a bus or a wire: on the grid while Snap is on, and on the axis of the wire's last corner. */
const meetOf = (drawing: Drawing | null, step: number, snap: boolean): Meet => ({ step, snap, ...(drawing ? { from: drawing.corners.at(-1) ?? drawing.start.at } : {}) })

/** What is under `world`: any pin, label, bus or wire while wiring or drawing (`active`), else only a pin. */
function underAtPoint(design: Design, camera: Camera | undefined, active: boolean, world: Point, meet: Meet): Under {
  if (!camera) return {}
  const reach = PORT_HIT_PX / camera.scale
  const pin = pinAt(design, world, reach)?.pin
  if (!active && !pin) return {}
  const end = endAt(design, world, reach, meet)
  return { ...(end ? { end } : {}), ...(pin ? { pin } : {}) }
}

/**
 * The bus member list: opened at a bus (a one-member bus needs none), then the member picked starts or ends the wire.
 * A build without that bus (an undo, say) closes it.
 */
function usePicking(design: Design, drawing: Drawing | null, setDrawing: (drawing: Drawing) => void, finish: (drawing: Drawing, target: WireEnd) => void) {
  const [picking, setPicking] = useState<Picking | null>(null)
  useEffect(() => {
    if (picking && !design.schematic.drawings.some((d) => `bus:${d.id}` === picking.bus.selector)) setPicking(null)
  }, [design, picking])
  const use = (bus: WireEnd, role: Picking["role"], member: string) => {
    const end = memberEnd(bus, member)
    if (role === "start") setDrawing(newDrawing(end, undefined))
    else if (drawing) finish(drawing, end)
  }
  const open = (bus: WireEnd, role: Picking["role"]) => {
    const [only, ...more] = bus.members ?? []
    if (only !== undefined && more.length === 0) return use(bus, role, only)
    setPicking({ bus, role })
  }
  const pick = (member: string) => {
    if (!picking) return
    setPicking(null)
    use(picking.bus, picking.role, member)
  }
  const cancelPick = useCallback(() => setPicking(null), [])
  /** Starts a wire at `end`; a bus asks for its member first. */
  const start = (end: WireEnd, pin: string | undefined) => (end.members ? open(end, "start") : setDrawing(newDrawing(end, pin)))
  return { picking, open, pick, cancelPick, start }
}

/** Sends a finished wire and draws it dashed until its build; a wire that cannot be written says why. */
function useFinish(design: Design, actions: Actions, pending: ReturnType<typeof usePendingWires>, setDrawing: (drawing: Drawing | null) => void, keep?: KeepOptions) {
  return (current: Drawing, target: WireEnd) => {
    setDrawing(null)
    const plan = planWire(design, current, target, keep)
    if (!("edits" in plan)) return plan.notice && actions.notify(plan.notice)
    const sent = pending.add(plan.points)
    void actions.edit(plan.edits, plan.summary).then((ok) => ok || pending.drop(sent))
  }
}

/**
 * Wires are drawn the way KiCad users expect: click a free pin, or press W over any pin, then click
 * a pin, a net label, a bus or a wire to connect; clicks on the sheet place corners; Esc or a right click cancels.
 * A wire that meets a bus picks one of the bus's members from a small list and is written to that member's net.
 */
export function useWireTool(input: WireInput) {
  const { design, camera, step, snap } = input
  const [wiring, setWiring] = useState(false)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const { under, setUnder, underRef } = useUnder(input.buildId)
  const pending = usePendingWires(input.builtFrom)
  const finish = useFinish(design, input.actions, pending, setDrawing, input.keep)
  const picks = usePicking(design, drawing, setDrawing, finish)
  const escape = () => (picks.picking ? picks.cancelPick() : drawing ? setDrawing(null) : setWiring(false))
  useWireKeys({ drawing, setDrawing, setWiring, underRef, start: picks.start, escape })
  const aimed = useMemo(() => (picks.picking?.role === "end" ? { end: picks.picking.bus } : under), [picks.picking, under])
  const preview = usePreview(drawing, aimed, input.cursor, step, snap)
  const activePins = useMemo(() => [drawing?.pin, under.pin].filter((id): id is string => id !== undefined), [drawing, under])
  const underAt = (world: Point): Under => underAtPoint(design, camera, wiring || drawing !== null, world, meetOf(drawing, step, snap))
  const press = (event: { button: number; shiftKey: boolean }, world: Point) =>
    pressWire({ design, camera, wiring, drawing, setDrawing, step, snap, finish, underAt, picks }, event, world)
  const cancel = useCallback(() => {
    setWiring(false)
    setDrawing(null)
    picks.cancelPick()
  }, [picks.cancelPick])
  const overPin = under.end !== undefined && (wiring || drawing !== null || (under.pin !== undefined && freePin(design, under.pin)))
  return {
    wiring,
    toggleWiring: () => {
      cancel()
      setWiring(!wiring)
    },
    /** Stops wiring and drops a wire in progress, e.g. when another tool takes over. */
    cancel,
    drawing,
    under,
    pendingWires: pending.visible,
    preview,
    activePins,
    overPin,
    press,
    hover: (world: Point) => setUnder(underAt(world)),
    leave: () => setUnder({}),
    /** The bus whose members are listed, if the list is open. */
    picking: picks.picking,
    pick: picks.pick,
    cancelPick: picks.cancelPick,
  }
}

interface PressContext {
  design: Design
  camera: Camera | undefined
  wiring: boolean
  drawing: Drawing | null
  setDrawing(drawing: Drawing | null): void
  step: number
  snap: boolean
  finish(drawing: Drawing, target: WireEnd): void
  underAt(world: Point): Under
  picks: Pick<ReturnType<typeof usePicking>, "picking" | "open" | "cancelPick" | "start">
}

/** Handles a press for the wire tool; false when the press is not the wire tool's, so the canvas can pan or drag. */
function pressWire(c: PressContext, event: { button: number; shiftKey: boolean }, world: Point): boolean {
  if (!c.camera) return false
  // A press on the sheet while the member list is open only closes the list.
  if (c.picks.picking) {
    c.picks.cancelPick()
    return true
  }
  if (event.button === 2 && c.drawing) {
    c.setDrawing(null)
    return true
  }
  if (event.button === 1 || event.button === 2 || event.shiftKey) return false
  if (c.drawing) {
    const target = endAt(c.design, world, PORT_HIT_PX / c.camera.scale, meetOf(c.drawing, c.step, c.snap))
    // A bus pin takes the bus whole; any other end picks one member.
    if (target?.members && !c.drawing.start.port?.bus) c.picks.open(target, "end")
    else if (target) c.finish(c.drawing, target)
    else addCorner(c.drawing, world, c, c.setDrawing)
    return true
  }
  const { end, pin } = c.underAt(world)
  if (!end || (!c.wiring && !(pin && freePin(c.design, pin)))) return false
  c.picks.start(end, pin)
  return true
}

/** A click on empty sheet places a corner, on the grid while snap is on. */
function addCorner(drawing: Drawing, world: Point, grid: { step: number; snap: boolean }, setDrawing: (drawing: Drawing) => void): void {
  const corner = snapPoint(world, grid.step, grid.snap)
  const last = drawing.corners[drawing.corners.length - 1] ?? drawing.start.at
  if (corner.x !== last.x || corner.y !== last.y) setDrawing({ ...drawing, corners: [...drawing.corners, corner], bends: [...drawing.bends, drawing.flip] })
}
