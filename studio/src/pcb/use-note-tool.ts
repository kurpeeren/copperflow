// Place → Note box: armed from the menu in either view, the next left drag draws the box where a note for the agent
// goes (gestures.ts), and then the tool is put away. Esc or a right click puts it away too.
import { useCallback, useState } from "react"
import type { CanvasToolCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { ArmedTool } from "./press"
import { useDisarmKey } from "./use-disarm-key"

/** The hint shown while the tool is armed. */
export const NOTE_HINT = "Drag a box where the note for the agent goes. Esc or a right click stops."

/** `onArm` lets the view's other tools step aside when this one is armed. */
export function useNoteTool(onArm?: () => void) {
  const [armed, setArmed] = useState(false)
  const disarm = useCallback(() => setArmed(false), [])
  const arm = useCallback(() => {
    onArm?.()
    setArmed(true)
  }, [onArm])
  useCommands({ noteBox: arm } satisfies Record<CanvasToolCommand, () => void>)
  useDisarmKey(armed, disarm)
  const tool: ArmedTool = armed ? "note" : null
  return { armed, tool, arm, disarm, hint: armed ? NOTE_HINT : undefined }
}
