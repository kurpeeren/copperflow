// The schematic's drawing tools (Place → Polyline, Arc, Circle, Rectangle, Text): which one is armed and the shape in
// progress (draw-tools.ts says what each event does), their commands and keys, the drawings sent and drawn dashed
// until their build, and the new drawing selected once its build lands. This hook only turns pointer and key events
// into draw-tools events.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { Selection, type SelectionChange } from "../selection"
import { useCommands } from "../shell/commands"
import { escapeDisarms, keyAction, keyInput, type KeyActionName } from "./canvas-keys"
import { DRAW_COMMAND_TOOL, DRAW_COMMANDS, isDrawCommand, type DrawCommand } from "./draw-commands"
import { drawingEdit, drawStep, drawSummary, idleState, isDoubleClick, previewDrawing, sentDrawing, toolPoint, type DrawEvent, type DrawState, type DrawTool, type NewDrawing } from "./draw-tools"
import type { Camera, Point } from "./geometry"
import type { Press } from "./press"

interface Input {
  design: Design
  circuit: CircuitData
  actions: Actions
  camera: Camera | undefined
  cursor: Point | undefined
  step: number
  snap: boolean
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  onSelect(change: SelectionChange): void
  /** Called when a tool is armed, so the wire tool, the Place tools and the note tool step aside. */
  onArm(): void
}

type Sent = { drawing: SchematicDrawing; sentAt: number }

/** The keys a shape in progress owns, as the canvas key rules read them (nothing in a field). */
const TOOL_KEYS: Partial<Record<KeyActionName, DrawEvent>> = {
  finishShape: { type: "finish" },
  removeCorner: { type: "removeCorner" },
  flipBend: { type: "flip" },
}

/** Drawings sent and drawn dashed until a build that started after each was sent has finished. */
function useSentDrawings(builtFrom: number) {
  const [sent, setSent] = useState<Sent[]>([])
  useEffect(() => setSent((list) => (list.every((s) => s.sentAt > builtFrom) ? list : list.filter((s) => s.sentAt > builtFrom))), [builtFrom])
  const visible = useMemo(() => sent.filter((s) => s.sentAt > builtFrom).map((s) => s.drawing), [sent, builtFrom])
  const add = useCallback((drawing: SchematicDrawing): Sent => {
    const entry = { drawing, sentAt: Date.now() }
    setSent((list) => [...list, entry])
    return entry
  }, [])
  const drop = useCallback((entry: Sent) => setSent((list) => list.filter((s) => s !== entry)), [])
  return { visible, add, drop }
}

/** Selects the drawing named `waiting` alone as soon as the sheet has it, then stops waiting. */
function useSelectWhenBuilt(design: Design, onSelect: Input["onSelect"]) {
  const [waiting, setWaiting] = useState<string>()
  useEffect(() => {
    if (waiting === undefined || !design.schematic.drawings.some((drawing) => drawing.id === waiting)) return
    onSelect(() => Selection.none.onlyDrawing(waiting))
    setWaiting(undefined)
  }, [design, waiting, onSelect])
  return setWaiting
}

/** Shift held, for a polyline's squared leg; forgotten when the window loses focus. */
function useShiftHeld(armed: boolean): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!armed) {
      setHeld(false)
      return
    }
    const onKey = (event: KeyboardEvent) => setHeld(event.shiftKey)
    const onBlur = () => setHeld(false)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
      window.removeEventListener("blur", onBlur)
    }
  }, [armed])
  return held
}

/** Alt+L, Alt+A, Alt+C, Alt+R and Alt+T arm a tool; the menu and the toolbar send the same commands. */
function useArmKeys(arm: (tool: DrawTool) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(keyInput(event), { view: "schematic" })?.action
      if (!action || !isDrawCommand(action)) return
      event.preventDefault()
      arm(DRAW_COMMAND_TOOL[action])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [arm])
  const commands = Object.fromEntries(DRAW_COMMANDS.map((command) => [command, () => arm(DRAW_COMMAND_TOOL[command])])) as Record<DrawCommand, () => void>
  useCommands(commands)
}

/**
 * The keys of an armed tool: Esc (captured, so it does not also clear the selection) cancels the shape in progress or
 * puts the tool away; with a shape in progress, Enter finishes a polyline, Backspace removes the last click and Space
 * flips the bend, by the canvas key rules (nothing in a field).
 */
function useToolKeys(state: DrawState | null, send: (event: DrawEvent) => void): void {
  useEffect(() => {
    if (!state) return
    const busy = state.points.length > 0
    const onEscape = (event: KeyboardEvent) => {
      if (!escapeDisarms(keyInput(event))) return
      event.stopPropagation()
      send({ type: "cancel" })
    }
    const onKey = (event: KeyboardEvent) => {
      const action = busy ? keyAction(keyInput(event), { view: "schematic", drawing: true })?.action : undefined
      const drawEvent = action === undefined ? undefined : TOOL_KEYS[action]
      if (!drawEvent) return
      event.preventDefault()
      send(drawEvent)
    }
    window.addEventListener("keydown", onEscape, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onEscape, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [state, send])
}

/** The armed tool's state; `send` runs one event through it and hands a finished drawing to `write`. */
function useToolState(onArm: () => void, write: (tool: DrawTool, drawing: NewDrawing) => void) {
  const [state, setState] = useState<DrawState | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const send = useCallback(
    (event: DrawEvent) => {
      const current = stateRef.current
      if (!current) return
      const next = drawStep(current, event)
      stateRef.current = next.state
      setState(next.state)
      if (next.drawing) write(current.tool, next.drawing)
    },
    [write],
  )
  const arm = useCallback(
    (tool: DrawTool) => {
      onArm()
      stateRef.current = idleState(tool)
      setState(stateRef.current)
    },
    [onArm],
  )
  const disarm = useCallback(() => {
    stateRef.current = null
    setState(null)
  }, [])
  return { state, send, arm, disarm }
}

/**
 * Sends a finished drawing as one edit, draws it dashed until its build, and selects it once the build has it. Names
 * sent stay taken until the circuit has them, so two drawings made before a build never get the same name.
 */
function useWrite(input: Input, sent: ReturnType<typeof useSentDrawings>) {
  const { circuit, actions } = input
  const { add, drop } = sent
  const selectWhenBuilt = useSelectWhenBuilt(input.design, input.onSelect)
  const taken = useRef<string[]>([])
  return useCallback(
    (tool: DrawTool, drawing: NewDrawing) => {
      const { model } = circuit
      taken.current = taken.current.filter((name) => !model.drawings.some((d) => d.name === name || d.id === name))
      const edit = drawingEdit(drawing, model, taken.current)
      const name = edit.name ?? ""
      taken.current = [...taken.current, name]
      const entry = add(sentDrawing(drawing, name))
      selectWhenBuilt(name)
      void actions.edit([edit], drawSummary(tool, name)).then((ok) => {
        if (ok) return
        taken.current = taken.current.filter((other) => other !== name)
        drop(entry)
        selectWhenBuilt(undefined)
      })
    },
    [circuit, actions, selectWhenBuilt, add, drop],
  )
}

export function useDrawTools(input: Input) {
  const { camera, cursor, step, snap } = input
  const sent = useSentDrawings(input.builtFrom)
  const write = useWrite(input, sent)
  const { state, send, arm, disarm } = useToolState(input.onArm, write)
  const shift = useShiftHeld(state !== null)
  const lastPress = useRef<{ at: Point; time: number }>(undefined)
  useArmKeys(arm)
  useToolKeys(state, send)
  const preview = useMemo(() => (state && cursor ? previewDrawing(state, toolPoint(cursor, step, snap), shift) : undefined), [state, cursor, step, snap, shift])

  /** A left press is a click of the tool (a double click's second press finishes a polyline); a right press cancels; the middle button pans. */
  const press = (event: Press, world: Point): boolean => {
    if (!state || !camera || event.button === 1) return false
    if (event.button === 2) {
      send({ type: "cancel" })
      return true
    }
    const now = { at: { x: world.x * camera.scale, y: world.y * camera.scale }, time: Date.now() }
    const double = isDoubleClick(lastPress.current, now)
    lastPress.current = double ? undefined : now
    send({ type: "press", at: toolPoint(world, step, snap), shift: event.shiftKey, double })
    return true
  }
  const pending = useMemo(() => (preview ? [...sent.visible, preview] : sent.visible), [sent.visible, preview])
  return {
    state,
    tool: state?.tool ?? null,
    armed: state !== null,
    /** A shape is in progress: the tool owns Space, Backspace and Enter. */
    busy: state !== null && state.points.length > 0,
    arm,
    disarm,
    press,
    release: (world: Point) => {
      if (state) send({ type: "release", at: toolPoint(world, step, snap) })
    },
    submitText: (text: string) => send({ type: "text", text }),
    cancelText: () => send({ type: "cancel" }),
    /** The shape in progress and the drawings waiting for their build, drawn dashed. */
    pending,
  }
}
