// What a Route → Autoroute run says while it runs and when it ends: the request's scope, the live events the server
// sends ("route"), the line the Studio's status bar shows, and the rule that discards a result computed for files
// that changed meanwhile. Pure and free of Node, so the Studio bundles it and the tests run it without a DOM.
import type { RouteScope, UnroutedConnection } from "../engine/router/route-board.js"

export type { RouteScope, UnroutedConnection }

/** One run's news, for the circuit file `file` (project-relative). */
export type RouteEvent =
  | { file: string; state: "started"; scope: RouteScope; inProcess?: boolean }
  | { file: string; state: "running"; pass: number; done: number; total: number }
  | { file: string; state: "cleanup"; capped: boolean }
  | {
      file: string
      state: "done"
      /** Connections routed, and the connections the scope covered. */
      routed: number
      total: number
      passes: number
      unrouted: UnroutedConnection[]
      cleanupCapped: boolean
      /** The history entry the copper was written in; absent when there was nothing to write. */
      entryId?: string
      /** The server's mark of the write: a build with a larger start mark shows the copper. */
      writeMark?: number
    }
  | { file: string; state: "discarded"; reason: string }
  | { file: string; state: "cancelled" }
  | { file: string; state: "failed"; error: string }

/** Whether the run the event tells of is still going. */
export const isRouting = (event: RouteEvent | undefined): boolean => event?.state === "started" || event?.state === "running" || event?.state === "cleanup"

const bare = (net: string) => net.replace(/^net\./, "")

/** What the scope covers, in words: "the board", "net GND", "R1, R2", "instance PS1". */
export function scopeText(scope: RouteScope): string {
  switch (scope.kind) {
    case "all":
      return "the board"
    case "nets":
      return `${scope.nets.length === 1 ? "net" : "nets"} ${scope.nets.map(bare).join(", ")}`
    case "parts":
      return scope.parts.join(", ")
    case "instance":
      return `instance ${scope.instance}`
  }
}

const MAX_SUMMARY = 200

/** The history entry's summary: "Autoroute the board: 32 of 32 connections". */
export function routeSummary(scope: RouteScope, routed: number, total: number): string {
  const text = `Autoroute ${scopeText(scope)}: ${routed} of ${total} connections`
  return text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1)}…`
}

const CAPPED = "cleanup stopped at its pass cap"
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`

/** The status bar's line for the latest event of a run. */
export function routeProgressText(event: RouteEvent): string {
  switch (event.state) {
    case "started":
      return event.inProcess ? "Autorouting in the server process (worker threads are unavailable)…" : "Autorouting…"
    case "running":
      return `Autorouting: pass ${event.pass}, ${event.done} of ${plural(event.total, "connection")}`
    case "cleanup":
      return event.capped ? `Autorouting: ${CAPPED}` : "Autorouting: cleaning up"
    case "done": {
      if (event.total === 0) return "Nothing to route: the scope has no connection left to route"
      const left = event.unrouted.length === 0 ? "" : `; ${event.unrouted.length} not routed, see Checks`
      const capped = event.cleanupCapped ? `; ${CAPPED}` : ""
      return `Routed ${event.routed} of ${plural(event.total, "connection")} in ${plural(event.passes, "pass", "passes")}${left}${capped}`
    }
    case "discarded":
      return event.reason
    case "cancelled":
      return "Autorouting cancelled; nothing was written"
    case "failed":
      return `Autorouting failed: ${event.error}`
  }
}

/** The content hashes of a circuit file and of its layout file (a missing file hashes as empty). */
export interface ContentHashes {
  circuit: string
  layout: string
}

/** Why a result computed from the files as they were at `start` must not be applied to them as they are at `end`. */
export function discardReason(start: ContentHashes, end: ContentHashes): string | undefined {
  const circuit = start.circuit !== end.circuit
  const layout = start.layout !== end.layout
  if (!circuit && !layout) return undefined
  const what = circuit && layout ? "The circuit and its layout file" : circuit ? "The circuit" : "The layout file"
  return `${what} changed while the board was routed, so the result was discarded; route again`
}
