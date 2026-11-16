import type { Annotations, LockViolation } from "../../src/core/annotations.js"
import type { HistoryListing, HistoryProblem } from "../../src/core/history.js"
import type { CircuitModel, Edit, Literal, PartInfo, PropInfo, TraceInfo } from "../../src/core/types.js"
import type { Design } from "../../src/engine/design.js"
import type { Diagnostic } from "../../src/engine/model.js"
import type { FabricationExport } from "../../src/core/fabrication.js"
import type { RouteEvent, RouteScope } from "../../src/studio/route-events.js"
import type { PlaceEvent, PlaceScope } from "../../src/studio/place-events.js"
import { networkErrorText, requestErrorText } from "./request-error.js"

export type { Annotations, CircuitModel, Design, Diagnostic, Edit, FabricationExport, HistoryListing, HistoryProblem, Literal, LockViolation, PartInfo, PropInfo, PlaceEvent, PlaceScope, RouteEvent, RouteScope, TraceInfo }

export interface CircuitData {
  file: string
  model: CircuitModel
  annotations: Annotations
  violations: LockViolation[]
}

export interface LibraryPart {
  id: string
  title: string
  mpn?: string
  footprint: string
  component: string
  verified: boolean
  verifiedBy?: string
  /** Where the part came from, e.g. "lcsc C7950, imported 2026-11-11". */
  origin?: string
}

export interface PartsData {
  library: LibraryPart[]
  builtin: string[]
}

export interface PartDetails {
  id: string
  part: {
    title: string
    manufacturer?: string
    mpn?: string
    footprint: string
    suppliers?: Record<string, string>
    datasheet?: { file?: string; url?: string }
    verified?: { by: string; against: string; date: string }
  }
  checklist: string
}

export interface BomLine {
  designators: string[]
  quantity: number
  kind: string
  value: string
  footprint: string
  manufacturer: string
  mpn: string
  supplier: string
  datasheet: string
  libraryPart?: string
  verified?: boolean
}

/** What GET /api/build returns. A failed build keeps the last design and says why in `error`. */
export interface BuildState {
  status: "idle" | "building" | "done" | "failed"
  design?: Design
  error?: string
  /** When the last finished build started; it holds every change sent before then. */
  startedAt?: string
  /** The server's mark when that build started; an edit response's writeMark below it is in the build. */
  startMark?: number
  finishedAt?: string
}

const TOKEN_KEY = "copperflow-token"
const RECONNECT_MS = 2000

/**
 * The session token arrives in the URL fragment printed by `copperflow studio`; fragments are
 * never sent to servers. It is kept in sessionStorage so a reload of this tab still works.
 */
function readToken(): string {
  const match = /[#&]token=([^&]+)/.exec(window.location.hash)
  if (match?.[1]) {
    const fromUrl = decodeURIComponent(match[1])
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl)
    } catch {
      // storage can be unavailable; the token still works until the tab reloads
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search)
    return fromUrl
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

const token = readToken()
export const hasToken = token !== ""

// Pasting the printed address into an open tab only changes the fragment, which does not reload.
window.addEventListener("hashchange", () => {
  if (/[#&]token=/.test(window.location.hash)) window.location.reload()
})

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-copperflow-token": token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    // The browser's own words ("Failed to fetch") say nothing; a refused connection is the server process gone.
    throw new Error(networkErrorText(error))
  }
  const json = (await response.json()) as { ok: boolean; data: T; error?: string }
  if (!json.ok) throw new Error(requestErrorText(response.status, json.error))
  return json.data
}

export type ServerEvent = "change" | "build" | "library" | "route" | "place"
const SERVER_EVENTS: readonly string[] = ["change", "build", "library", "route", "place"] satisfies ServerEvent[]

/**
 * Subscribes to file changes, build updates and routing news; returns an unsubscribe function. A "route" event also
 * gives its data, a RouteEvent. Uses fetch rather than EventSource so the token goes in a header, not in the URL.
 * `onConnection` hears false when the stream cannot connect and true when it is open again.
 */
export function subscribe(onEvent: (event: ServerEvent, file: string, data: Record<string, unknown>) => void, onConnection?: (connected: boolean) => void): () => void {
  const controller = new AbortController()
  const handle = (block: string) => {
    const event = /^event: (.+)$/m.exec(block)?.[1]
    const data = /^data: (.+)$/m.exec(block)?.[1]
    if (event !== undefined && SERVER_EVENTS.includes(event) && data) {
      const parsed = JSON.parse(data) as Record<string, unknown>
      onEvent(event as ServerEvent, typeof parsed.file === "string" ? parsed.file : "", parsed)
    }
  }
  const listen = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch("/api/events", { headers: { "x-copperflow-token": token }, signal: controller.signal })
        if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status})`)
        onConnection?.(true)
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ""
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += value
          for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
            handle(buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof TypeError) onConnection?.(false)
      }
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS))
    }
  }
  void listen()
  return () => controller.abort()
}

/** What /api/history answers: the entries it could read, and the entry files it skipped. */
export interface HistoryResult {
  entries: HistoryListing[]
  problems: HistoryProblem[]
}
