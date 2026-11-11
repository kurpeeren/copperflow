// Place → No connect flag and Place → Junction on the schematic: the armed tool, its commands (Alt+J arms Junction),
// Esc, and a click, which writes one edit (sheet-marks.ts says what). The tool stays armed for the next click, as
// EasyEDA's do; Esc or a right click puts it away.
import { useCallback, useEffect, useRef, useState } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { MarkCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { escapeDisarms, keyAction, keyInput } from "./canvas-keys"
import type { Camera, Point } from "./geometry"
import type { Press } from "./press"
import { junctionClick, noConnectClick } from "./sheet-marks"

/** How close to a pin end or a wire a click must be, in CSS pixels. */
const MARK_REACH_PX = 12

export type MarkTool = MarkCommand

interface Input {
  design: Design
  circuit: CircuitData
  actions: Actions
  camera: Camera | undefined
  locked: ReadonlySet<string>
  /** Called when a tool is armed, so the other tools step aside. */
  onArm(): void
}

const HINTS: Readonly<Record<MarkTool, string>> = {
  noConnect: "No connect flag: click the end of a pin to flag it (again to take the flag off). Esc to stop.",
  junction: "Junction: click a wire to put a junction on it. Esc to stop.",
}

export function useSheetMarks(input: Input) {
  const [tool, setTool] = useState<MarkTool | null>(null)
  const latest = useRef(input)
  latest.current = input
  const arm = useCallback((next: MarkTool) => {
    latest.current.onArm()
    setTool(next)
  }, [])
  const disarm = useCallback(() => setTool(null), [])
  useCommands({ noConnect: () => arm("noConnect"), junction: () => arm("junction") } satisfies Record<MarkCommand, () => void>)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const press = keyInput(event)
      if (escapeDisarms(press) && tool) {
        event.stopPropagation()
        return setTool(null)
      }
      if (keyAction(press, { view: "schematic" })?.action !== "junction") return
      event.preventDefault()
      arm("junction")
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [tool, arm])
  /** A left click marks; a right click puts the tool away; false when no tool is armed. */
  const press = (event: Press, world: Point): boolean => {
    const { design, circuit, actions, camera, locked } = latest.current
    if (!tool || !camera || event.button === 1) return false
    if (event.button === 2) {
      setTool(null)
      return true
    }
    const reach = MARK_REACH_PX / camera.scale
    const result =
      tool === "junction"
        ? junctionClick(design.schematic, world, reach)
        : noConnectClick({ sheet: design.schematic, components: design.circuit.components, parts: circuit.model.parts, locked }, world, reach)
    if ("message" in result) actions.notify(result.message)
    else void actions.edit([result.edit], result.summary)
    return true
  }
  return { tool, armed: tool !== null, arm, disarm, press, hint: tool ? HINTS[tool] : undefined }
}
