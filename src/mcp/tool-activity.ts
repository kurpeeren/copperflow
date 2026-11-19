// What a tool call is doing, told while it runs: to the MCP client as `notifications/progress` when the request carried
// a progressToken, and to this project's running Studio (studio-activity.ts). Every call says that it started and how
// it ended; the long tools (autoroute, autoplace, the exports, the 3D render) also say each step through the reporter
// that `run` hands them. The reporter of the call being answered is kept in async context, so the other tools' code
// does not change.
import { AsyncLocalStorage } from "node:async_hooks"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { MAX_ACTIVITY_MESSAGE, type AgentActivity } from "../studio/activity-event.js"
import type { StudioLink } from "./studio-activity.js"

/** The token a client gives a request it wants progress for. */
type ProgressToken = string | number

/** Counted progress is told at most this often (about four times a second); a new step always. */
export const TICK_MS = 250
/** The argument shown after the tool's name, cut to this length. */
const MAX_ARGUMENT = 80
/** The arguments that name what a tool works on, in the order they are looked for. */
const MAIN_ARGUMENTS = ["file", "id", "part", "topic", "lcsc", "name"] as const

/** What a long tool says while it works. */
export interface Reporter {
  /** A new step ("Writing the Gerbers"); always told. */
  step(message: string): void
  /** How far a counted step is ("Routing: 3 of 8 connections, pass 2"); told at most every TICK_MS. */
  count(message: string, done: number, total: number): void
  /** Whether anyone hears it: the client asked for progress, or a Studio is open on the project. */
  readonly heard: boolean
}

/** The reporter of a call nobody listens to. */
export const QUIET: Reporter = { step: () => undefined, count: () => undefined, heard: false }

const current = new AsyncLocalStorage<Reporter>()

/** The reporter of the tool call this code runs for; QUIET outside one. */
export const currentReporter = (): Reporter => current.getStore() ?? QUIET

/** "autoroute amp.circuit.tsx": the tool and the argument that names what it works on. */
export function activityLine(tool: string, args: unknown): string {
  const given = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
  const main = MAIN_ARGUMENTS.map((key) => given[key]).find((value): value is string => typeof value === "string" && value !== "")
  if (main === undefined) return tool
  return `${tool} ${main.length > MAX_ARGUMENT ? `${main.slice(0, MAX_ARGUMENT - 1)}…` : main}`
}

/** The numbers sent so far; progress must grow with every notification (the MCP specification). */
export interface ProgressNumbers {
  sent: number
  /** Added to the tool's own count: where the current counted step started. */
  base: number
  /** The tool's own count last given; Infinity after an uncounted step. */
  last: number
  /** The largest total sent; a later total is never smaller, so a client's bar never jumps back. */
  total: number
}

export const NO_PROGRESS: ProgressNumbers = { sent: 0, base: 0, last: -1, total: 0 }

/**
 * The progress (and total) a notification carries for the tool's count, or none when it would not grow. A step is one
 * unit; a count lower than the last one (a router's next pass) continues after what was sent, its total moved with it.
 * The same count told again is not a new pass, so it moves nothing.
 */
export function nextProgress(state: ProgressNumbers, done?: number, total?: number): { state: ProgressNumbers; send?: { progress: number; total?: number } } {
  if (done === undefined) {
    const progress = state.sent + 1
    return { state: { ...state, sent: progress, base: progress, last: Number.POSITIVE_INFINITY }, send: { progress } }
  }
  const base = done >= state.last ? state.base : state.sent
  const progress = base + done
  if (progress <= state.sent) return { state: { ...state, base, last: done } }
  if (total === undefined) return { state: { ...state, sent: progress, base, last: done }, send: { progress } }
  const shown = Math.max(progress, base + total, state.total)
  return { state: { sent: progress, base, last: done, total: shown }, send: { progress, total: shown } }
}

/** What a call's activity is told through. */
export interface ActivityChannels {
  tool: string
  /** The client's token for this request, when it asked for progress. */
  progressToken?: ProgressToken | undefined
  notify?: ((progress: { progress: number; total?: number; message: string }) => void) | undefined
  studio?: StudioLink | undefined
  studioOpen: boolean
  now?: () => number
}

/** The start, the steps and the end of one tool call. */
export interface CallActivity {
  reporter: Reporter
  start(message: string): void
  end(ok: boolean, message: string): void
}

export function callActivity(channels: ActivityChannels): CallActivity {
  const now = channels.now ?? Date.now
  const toClient = channels.progressToken !== undefined ? channels.notify : undefined
  const toStudio = channels.studioOpen ? channels.studio : undefined
  let numbers = NO_PROGRESS
  let lastCount = Number.NEGATIVE_INFINITY
  const tell = (state: AgentActivity["state"], message: string, done?: number, total?: number) => {
    const line = message.slice(0, MAX_ACTIVITY_MESSAGE)
    toStudio?.tell({ tool: channels.tool, message: line, state, ...(done === undefined ? {} : { progress: done }), ...(total === undefined ? {} : { total }) })
    if (toClient === undefined || state !== "running") return
    const next = nextProgress(numbers, done, total)
    numbers = next.state
    if (next.send) toClient({ ...next.send, message: line })
  }
  const reporter: Reporter = {
    heard: toClient !== undefined || toStudio !== undefined,
    step: (message) => tell("running", message),
    count: (message, done, total) => {
      const at = now()
      if (at - lastCount < TICK_MS && done < total) return
      lastCount = at
      tell("running", message, done, total)
    },
  }
  return {
    reporter,
    // The start goes to the Studio only: the client knows it asked.
    start: (message) => toStudio?.tell({ tool: channels.tool, message: message.slice(0, MAX_ACTIVITY_MESSAGE), state: "running" }),
    end: (ok, message) => tell(ok ? "done" : "failed", message),
  }
}

type Handler = (request: unknown, extra: unknown) => Promise<unknown>
interface WithHandlers {
  _requestHandlers: Map<string, Handler>
}
interface CallExtra {
  _meta?: { progressToken?: ProgressToken }
  sendNotification(notification: { method: "notifications/progress"; params: Record<string, unknown> }): Promise<void>
}

/** The first line of a failed call's answer, after the tool's line. */
function failedLine(line: string, result: CallToolResult | undefined, error: unknown): string {
  const text = error !== undefined ? (error instanceof Error ? error.message : String(error)) : result?.content.find((part) => part.type === "text")?.text
  const first = text?.split("\n")[0]?.trim()
  return first ? `${line}: ${first}` : `${line} failed`
}

/**
 * Wraps the server's tools/call answer so every call tells its activity and runs with its reporter; call it after every
 * tool is registered. Progress notifications and Studio posts are best effort: a client or Studio that cannot take them
 * changes nothing in the answer.
 */
export function tellToolActivity(server: McpServer, studio: StudioLink | undefined): void {
  const handlers = (server.server as unknown as WithHandlers)._requestHandlers
  const original = handlers.get("tools/call")
  if (original === undefined) throw new Error("tellToolActivity: register the tools first")
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params
    const given = extra as unknown as CallExtra
    const progressToken = given._meta?.progressToken
    const notify = (progress: { progress: number; total?: number; message: string }) => {
      // Best effort: a client that went away cannot be told, and the call's own answer says how it ended.
      given.sendNotification({ method: "notifications/progress", params: { progressToken, ...progress } }).catch(() => undefined)
    }
    const activity = callActivity({ tool: name, progressToken, notify, studio, studioOpen: studio !== undefined && (await studio.present()) })
    const line = activityLine(name, args)
    activity.start(line)
    try {
      const result = (await current.run(activity.reporter, () => original(request, extra))) as CallToolResult
      activity.end(result.isError !== true, result.isError === true ? failedLine(line, result, undefined) : line)
      return result as never
    } catch (error) {
      activity.end(false, failedLine(line, undefined, error))
      throw error
    }
  })
}
