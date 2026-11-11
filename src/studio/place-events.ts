// What a Place → Autoplace run says while it runs and when it ends: the live events the server sends ("place"), the
// line the Studio's status bar shows, and the history entry's summary. Pure and free of Node, so the Studio bundles it.
import type { PlaceScope } from "../engine/pcb-place/scope.js"

export type { PlaceScope }

/** A part the placer left where it was, and why. */
export interface UnplacedNote {
  name: string
  reason: string
}

/** One run's news, for the circuit file `file` (project-relative). */
export type PlaceEvent =
  | { file: string; state: "started"; scope: PlaceScope; inProcess?: boolean }
  | { file: string; state: "running"; stage: "construct" | "refine"; done: number; total: number }
  | {
      file: string
      state: "done"
      /** Parts whose positions were written. */
      placed: number
      /** Total ratsnest length after and before, in mm. */
      wireLength: number
      before: number
      unplaced: UnplacedNote[]
      /** The placer's notes, positions not written and parts skipped (locked meanwhile, read-only). */
      notes: string[]
      /** The board fitted round the parts, when asked: its size in mm, or why it was not fitted. */
      board?: { width: number; height: number } | { error: string }
      entryId?: string
      writeMark?: number
    }
  | { file: string; state: "discarded"; reason: string }
  | { file: string; state: "cancelled" }
  | { file: string; state: "failed"; error: string }

export const isPlacing = (event: PlaceEvent | undefined): boolean => event?.state === "started" || event?.state === "running"

/** The server's mark of the run's write, when it wrote one. */
export const placedMark = (event: PlaceEvent): number | undefined => (event.state === "done" && event.entryId !== undefined ? event.writeMark : undefined)

/** What the scope covers, in words: "the board", "R1, R2", "instance PS1". */
export function placeScopeText(scope: PlaceScope): string {
  if (scope.kind === "all") return "the board"
  if (scope.kind === "parts") return scope.parts.join(", ")
  return `instance ${scope.instance}`
}

const MAX_SUMMARY = 200
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const mm = (v: number) => String(Math.round(v))

/** The history entry's summary: "Autoplace the board: 12 parts". */
export function placeSummary(scope: PlaceScope, placed: number): string {
  const text = `Autoplace ${placeScopeText(scope)}: ${plural(placed, "part")}`
  return text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1)}…`
}

/** The status bar's line for the latest event of a run. */
export function placeProgressText(event: PlaceEvent): string {
  switch (event.state) {
    case "started":
      return event.inProcess ? "Autoplacing in the server process (worker threads are unavailable)…" : "Autoplacing…"
    case "running":
      return event.stage === "construct" ? `Autoplacing: ${event.done} of ${plural(event.total, "part")}` : `Autoplacing: refining, ${Math.round((100 * event.done) / Math.max(1, event.total))}%`
    case "done": {
      if (event.placed === 0 && event.unplaced.length === 0) return "Nothing to place: every part in the scope is placed or locked"
      const left = event.unplaced.length === 0 ? "" : `; ${event.unplaced.length} not placed (${event.unplaced.map((u) => u.name).join(", ")})`
      const board = event.board && "width" in event.board ? `; board ${event.board.width} × ${event.board.height} mm` : ""
      return `Placed ${plural(event.placed, "part")}; wire length ${mm(event.wireLength)} mm (was ${mm(event.before)})${board}${left}`
    }
    case "discarded":
      return event.reason
    case "cancelled":
      return "Autoplacing cancelled; nothing was written"
    case "failed":
      return `Autoplacing failed: ${event.error}`
  }
}
