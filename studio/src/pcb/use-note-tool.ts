// The one-shot box tools, armed from the menu or the toolbar in either view: Place → Note box, whose next left drag
// draws the box where a note for the agent goes, and View → Fit area, whose next left drag draws the box the camera
// then fits (gestures.ts). Each is put away after its box. Esc or a right click puts it away too. One tool is armed
// at a time (box-tool.ts).
import { useCallback, useEffect, useState } from "react"
import type { CanvasToolCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { clearToolState, setToolState } from "../shell/tool-state"
import { armBoxTool, boxToolCommand, boxToolHint, type BoxTool } from "./box-tool"
import type { ArmedTool } from "./press"
import { useDisarmKey } from "./use-disarm-key"

export { FIT_AREA_HINT, NOTE_HINT } from "./box-tool"

/** `onArm` lets the view's other tools step aside when one of these is armed. */
export function useNoteTool(onArm?: () => void) {
  const [which, setWhich] = useState<BoxTool | null>(null)
  const disarm = useCallback(() => setWhich(null), [])
  const arm = useCallback(
    (tool: BoxTool) => {
      onArm?.()
      setWhich(armBoxTool(tool))
    },
    [onArm],
  )
  useCommands({ noteBox: () => arm("note"), fitArea: () => arm("zoom") } satisfies Record<CanvasToolCommand, () => void>)
  useDisarmKey(which !== null, disarm)
  const tool: ArmedTool = which
  return { armed: which !== null, which, tool, arm, disarm, hint: boxToolHint(which) }
}

/** On the PCB, which has no other tool: tells the toolbar when Fit area is armed, and how to put it away. */
export function useBoxToolState(which: BoxTool | null, disarm: () => void): void {
  const active = boxToolCommand(which)
  useEffect(() => {
    setToolState({ active, stop: disarm })
  }, [active, disarm])
  useEffect(() => clearToolState, [])
}
