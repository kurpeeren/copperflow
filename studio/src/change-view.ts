// The change view's rules: which change "Since my last change" starts after, the keys, the commands it turns off and
// which design each mode draws. Plain TypeScript with .js imports, so the tests can run it.
import type { Design } from "../../src/engine/design.js"
import type { HistoryListing } from "../../src/core/history.js"
import type { ChangeShown } from "../../src/studio/change-route.js"
import { LOCKED_COMMANDS } from "./ai-lock.js"
import type { ChangeMode } from "./pcb/change-draw.js"
import type { CommandsOff } from "./shell/menus.js"

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

/** The person's newest change, when the agent made changes after it (the history newest first); otherwise none. */
export function sinceMyLast(history: readonly Pick<HistoryListing, "id" | "author">[]): string | undefined {
  if (history[0]?.author !== "ai") return undefined
  return history.find((entry) => entry.author === "human")?.id
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
