// The schematic's Place tools (Net label, GND, VCC): which one is armed, its name, the inline name input, its keys,
// and the labels waiting for their build. What an edit says is in label-palette.ts.
import { useEffect, useMemo, useRef, useState } from "react"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { keyAction, keyInput } from "./canvas-keys"
import type { Camera, Point } from "./geometry"
import { joinedNet, labelNameFor, nameProblem, pendingLabel, placeLabelEdits, placeSummary, type LabelTool, type PendingLabel } from "./label-palette"
import { pinAt } from "./wire-tool"

const PIN_HIT_PX = 12

/** The name input, open at `at` (sheet units): for a click on `pin`, or before any click when `pin` is undefined. */
export interface NameEditing {
  at: Point
  initial: string
  pin?: string
}

interface Input {
  design: Design
  circuit: CircuitData
  actions: Actions
  camera: Camera | undefined
  cursor: Point | undefined
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  /** Called when a tool is armed, so another tool (the wire tool) can step aside. */
  onArm(): void
}

type Sent = PendingLabel & { sentAt: number }

/** Labels sent and drawn dashed until a build that started after each was sent has finished. */
function usePendingLabels(builtFrom: number) {
  const [sent, setSent] = useState<Sent[]>([])
  useEffect(() => setSent((list) => (list.every((s) => s.sentAt > builtFrom) ? list : list.filter((s) => s.sentAt > builtFrom))), [builtFrom])
  const visible = useMemo(() => sent.filter((s) => s.sentAt > builtFrom), [sent, builtFrom])
  const add = (pending: PendingLabel): Sent => {
    const entry = { ...pending, sentAt: Date.now() }
    setSent((list) => [...list, entry])
    return entry
  }
  const drop = (entry: Sent) => setSent((list) => list.filter((s) => s !== entry))
  return { visible, add, drop }
}

/** Esc stops the tool; it is captured so the same Escape does not also clear the selection or stop wiring. */
function useDisarmKey(armed: boolean, disarm: () => void): void {
  useEffect(() => {
    if (!armed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || keyInput(event).typing) return
      event.stopPropagation()
      disarm()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [armed, disarm])
}

/** Alt+N arms the net label tool. */
function useArmKey(arm: (tool: LabelTool) => void): void {
  const latest = useRef(arm)
  latest.current = arm
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyAction(keyInput(event), { view: "schematic" })?.action !== "armNetLabel") return
      event.preventDefault()
      latest.current("label")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

export function useLabelPalette({ design, circuit, actions, camera, cursor, builtFrom, onArm }: Input) {
  const [tool, setTool] = useState<LabelTool | null>(null)
  /** The name typed with Tab before a click; a net label asks again after each placement, VCC keeps it. */
  const [typed, setTyped] = useState("")
  const [editing, setEditing] = useState<NameEditing | null>(null)
  const pending = usePendingLabels(builtFrom)
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])

  const disarm = () => {
    setTool(null)
    setTyped("")
    setEditing(null)
  }
  const arm = (next: LabelTool) => {
    onArm()
    setTool(next)
    setTyped("")
    setEditing(null)
  }
  const place = (activeTool: LabelTool, pinId: string, name: string) => {
    const edits = placeLabelEdits(design, circuit, activeTool, name, pinId, locked)
    if (!Array.isArray(edits)) return actions.notify(edits.blocked)
    const shown = labelNameFor(activeTool, name)
    const other = joinedNet(design, pinId, shown)
    if (other && !window.confirm(`This joins ${other} and ${shown} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) return
    const ghost = pendingLabel(design, activeTool, name, pinId)
    const sent = ghost && pending.add(ghost)
    const from = edits[0]?.kind === "addTrace" ? edits[0].from : pinId
    void actions.edit(edits, placeSummary(activeTool, shown, from)).then((ok) => ok || (sent && pending.drop(sent)))
    if (activeTool === "label") setTyped("")
  }
  const click = (activeTool: LabelTool, pinId: string, at: Point) => {
    if (activeTool === "label" && typed === "") return setEditing({ pin: pinId, at, initial: "" })
    place(activeTool, pinId, typed)
  }
  const press = (event: { button: number; shiftKey: boolean }, world: Point): boolean => {
    if (!tool || !camera) return false
    if (event.button === 2) {
      disarm()
      return true
    }
    if (event.button !== 0 || event.shiftKey) return false
    const hit = pinAt(design, world, PIN_HIT_PX / camera.scale)
    if (!hit) return false
    click(tool, hit.pin, hit.at)
    return true
  }
  /** The name input's Enter: places at the pin it was opened for, or keeps the name for the next click. Returns what is wrong with the name. */
  const submitName = (text: string): string | undefined => {
    const name = text.trim()
    const problem = nameProblem(name)
    if (problem || !tool || !editing) return problem
    setEditing(null)
    if (editing.pin) place(tool, editing.pin, name)
    else setTyped(name)
    return undefined
  }

  // Tab, before a click, opens the name input; for VCC it starts with the name VCC.
  useEffect(() => {
    if (tool !== "label" && tool !== "vcc") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || keyInput(event).typing) return
      event.preventDefault()
      setEditing({ at: cursor ?? { x: camera?.cx ?? 0, y: camera?.cy ?? 0 }, initial: typed || (tool === "vcc" ? "VCC" : "") })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tool, typed, cursor, camera])
  useDisarmKey(tool !== null, disarm)
  useArmKey(arm)

  const ghosts: NetLabel[] = pending.visible.map((s) => s.label)
  return {
    tool,
    armed: tool !== null,
    arm,
    disarm,
    press,
    editing,
    cancelName: () => setEditing(null),
    submitName,
    typed,
    ghosts,
    ghostWires: pending.visible.map((s) => s.wire),
  }
}
