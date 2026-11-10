// Why a command cannot run with `count` parts selected, for the menus and the toolbar: the align and distribute
// commands need two or three, Fit selection and Rotate right need one. No imports beyond align-rules, so both can read it.
import { alignDisabledReason, isAlignCommand } from "./align-rules.js"

/** The commands that act on the selection and need at least one part. */
export const SELECTION_COMMANDS = ["fitSelection", "rotateRight", "selectInstance", "replicateLayout", "makeSheet"] as const

/** What the tooltip of a command that needs a part says while nothing is selected. */
export const SELECT_A_PART = "Select a part first"

const needsOne = (command: string): boolean => (SELECTION_COMMANDS as readonly string[]).includes(command)

/** Why the command cannot run with `count` parts selected, or null when it can (or does not depend on the selection). */
export function commandDisabledReason(command: string, count: number): string | null {
  if (isAlignCommand(command)) return alignDisabledReason(command, count)
  return needsOne(command) && count < 1 ? SELECT_A_PART : null
}
