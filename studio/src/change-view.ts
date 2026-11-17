// The change view's rules: which change "Since my last change" starts after, the keys, the commands it turns off and
// which design each mode draws. Plain TypeScript with .js imports, so the tests can run it.
import type { Design } from "../../src/engine/design.js"
import type { HistoryListing } from "../../src/core/history.js"
import type { ChangeShown } from "../../src/studio/change-route.js"
import { LOCKED_COMMANDS } from "./ai-lock.js"
import type { ChangeMode } from "./pcb/change-draw.js"
import type { CommandsOff } from "./shell/menus.js"
import { fitCamera, pointBounds, unionBoxes, type Camera, type Size } from "./pcb/geometry.js"

/** The share of the area left round the board when it is fitted. */
const FIT_MARGIN = 0.04

export type { ChangeMode }

/** One change, or everything after one. */
export type ChangeRequest = { id: string } | { since: string }

export interface ChangeViewState {
  request: ChangeRequest
  mode: ChangeMode
  status: "loading" | "ready" | "failed"
  data?: ChangeShown
  error?: string
}

/** What the bar says, and what an editing command says while a change is shown. */
export const CHANGE_VIEW_MESSAGE = "A change is shown: the board cannot be edited. Close it to edit."

/**
 * What the Log's button above the list shows, the history newest first: everything after the person's newest change
 * when the agent changed things after it; everything the agent did when the person made no change at all; else none.
 */
export function sinceMyLast(history: readonly Pick<HistoryListing, "id" | "author">[]): { since: string; label: string } | undefined {
  if (history[0]?.author !== "ai") return undefined
  const mine = history.find((entry) => entry.author === "human")?.id
  return mine ? { since: mine, label: "Since my last change" } : { since: "c0000", label: "Everything the agent did" }
}

/** The camera that fits the board (or its parts) to the area, as the PCB view fits it. */
export function changeFit(design: Design, size: Size): Camera | undefined {
  const pcb = design.pcb
  const box = pointBounds(pcb.board?.outline ?? []) ?? unionBoxes(pcb.parts.flatMap((part) => pointBounds(part.courtyard) ?? []))
  return box && size.width > 0 && size.height > 0 ? fitCamera(box, size, FIT_MARGIN) : undefined
}

/** What a key does while a change is shown. */
export function changeKey(key: string): "close" | undefined {
  return key === "Escape" ? "close" : undefined
}

/** While a change is shown every command that edits is off, with the reason. */
export function changeOff(shown: boolean): CommandsOff {
  return shown ? Object.fromEntries(LOCKED_COMMANDS.map((command) => [command, CHANGE_VIEW_MESSAGE])) : {}
}

/** Before draws the design before the change; After and Both the design after it. */
export function designFor(data: Pick<ChangeShown, "before" | "after">, mode: ChangeMode): Design | undefined {
  return mode === "before" ? data.before : data.after
}

export function changePath(request: ChangeRequest): string {
  return "id" in request ? `/api/change?id=${encodeURIComponent(request.id)}` : `/api/change?since=${encodeURIComponent(request.since)}`
}
