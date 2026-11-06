// The schematic's Place tools (Net label, GND, VCC): which one is armed, its name, the inline name input, its keys,
// and the labels waiting for their build. What an edit says is in label-palette.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

/**
 * Esc puts the tool away, first, whatever is selected. It is captured and stopped so the same Escape does not
 * also clear the selection or stop wiring; the next Escape does. The name input handles its own Escape.
 */
function useDisarmKey(armed: boolean, disarm: () => void): void {
  useEffect(() => {
    if (!armed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest(".label-name"))) return
      event.stopPropagation()
      disarm()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [armed, disarm])
}

/** Alt+N arms the net label tool. */
function useArmKey(arm: (tool: LabelTool) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyAction(keyInput(event), { view: "schematic" })?.action !== "armNetLabel") return
      event.preventDefault()
      arm("label")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [arm])
}

/** Tab, before a click, opens the name input; for VCC it starts with the name VCC. */
function useNameKey(tool: LabelTool | null, typed: string, where: Point, open: (editing: NameEditing) => void): void {
  useEffect(() => {
    if (tool !== "label" && tool !== "vcc") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || keyInput(event).typing) return
      event.preventDefault()
      open({ at: where, initial: typed || (tool === "vcc" ? "VCC" : "") })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tool, typed, where, open])
}

interface PlaceInput extends Input {
  tool: LabelTool | null
  typed: string
  setTyped(name: string): void
  setEditing(editing: NameEditing | null): void
  pending: ReturnType<typeof usePendingLabels>
}

/** Sends the edit that puts a tool on a pin, after the confirmation a join of two named nets asks for. */
function usePlace({ design, circuit, actions, pending, setTyped }: PlaceInput) {
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  return (tool: LabelTool, pinId: string, name: string): void => {
    const edits = placeLabelEdits(design, circuit, tool, name, pinId, locked)
    if (!Array.isArray(edits)) return actions.notify(edits.blocked)
    const shown = labelNameFor(tool, name)
    const other = joinedNet(design, pinId, shown)
    if (other && !window.confirm(`This joins ${other} and ${shown} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) return
    const ghost = pendingLabel(design, tool, name, pinId)
    const sent = ghost && pending.add(ghost)
    const from = edits[0]?.kind === "addTrace" ? edits[0].from : pinId
    void actions.edit(edits, placeSummary(tool, shown, from)).then((ok) => ok || (sent && pending.drop(sent)))
    if (tool === "label") setTyped("")
  }
}

/** The pointer and the name input: a press on a pin places the tool or asks for a name; Enter in the input places or keeps the name. */
function useClicks(input: PlaceInput) {
  const { tool, typed, camera, design, setTyped, setEditing } = input
  const place = usePlace(input)
  const open = setEditing
  const press = (event: { button: number; shiftKey: boolean }, world: Point, disarm: () => void): boolean => {
    if (!tool || !camera) return false
    if (event.button === 2) {
      disarm()
      return true
    }
    if (event.button !== 0 || event.shiftKey) return false
    const hit = pinAt(design, world, PIN_HIT_PX / camera.scale)
    if (!hit) return false
    if (tool === "label" && typed === "") open({ pin: hit.pin, at: hit.at, initial: "" })
    else place(tool, hit.pin, typed)
    return true
  }
  const submitName = (text: string, current: NameEditing | null): string | undefined => {
    const name = text.trim()
    const problem = nameProblem(name)
    if (problem || !tool || !current) return problem
    open(null)
    if (current.pin) place(tool, current.pin, name)
    else setTyped(name)
    return undefined
  }
  return { press, submitName, open }
}

export function useLabelPalette(input: Input) {
  const { camera, cursor, onArm } = input
  const [tool, setTool] = useState<LabelTool | null>(null)
  /** The name typed with Tab before a click; a net label asks again after each placement, VCC keeps it. */
  const [typed, setTyped] = useState("")
  const [editing, setEditing] = useState<NameEditing | null>(null)
  const pending = usePendingLabels(input.builtFrom)
  const disarm = useCallback(() => {
    setTool(null)
    setTyped("")
    setEditing(null)
  }, [])
  const arm = useCallback(
    (next: LabelTool) => {
      onArm()
      setTool(next)
      setTyped("")
      setEditing(null)
    },
    [onArm],
  )
  const clicks = useClicks({ ...input, tool, typed, setTyped, setEditing, pending })
  const where = useMemo(() => cursor ?? { x: camera?.cx ?? 0, y: camera?.cy ?? 0 }, [cursor, camera])
  useNameKey(tool, typed, where, clicks.open)
  useDisarmKey(tool !== null, disarm)
  useArmKey(arm)

  const ghosts: NetLabel[] = pending.visible.map((s) => s.label)
  return {
    tool,
    armed: tool !== null,
    arm,
    disarm,
    press: (event: { button: number; shiftKey: boolean }, world: Point) => clicks.press(event, world, disarm),
    editing,
    cancelName: () => clicks.open(null),
    submitName: (text: string) => clicks.submitName(text, editing),
    typed,
    ghosts,
    ghostWires: pending.visible.map((s) => s.wire),
  }
}
