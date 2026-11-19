// The strip under the toolbar that says what the agent is doing ("Agent: Routing: 3 of 8 connections"), from the
// "activity" events the agent's MCP process sends through the Studio. A state machine with its timers as data: events
// in, what to show and when it goes out; AgentStrip.tsx only draws it and keeps one timer.
import type { AgentActivity } from "../../../src/studio/activity-event.js"

/** How long "done" stays before the strip goes. */
export const DONE_SHOWN_MS = 4000
/**
 * How long a "running" strip stays without news: past the longest tool (a 300 s routing budget and its cleanup), so it
 * only ends a strip whose agent process went away mid-call and never said it ended.
 */
export const RUNNING_STALE_MS = 6 * 60_000

export type StripTone = "running" | "done" | "failed"

export interface AgentStripView {
  text: string
  tone: StripTone
  /** How far, 0 to 1, when the activity has a total. */
  fraction?: number
}

export interface StripState {
  strip?: AgentStripView
  /** When the strip goes, in the clock's ms; none for a failure, which waits for a click or the next activity. */
  hideAt?: number
}

export const NO_STRIP: StripState = {}

const STATES: readonly string[] = ["running", "done", "failed"] satisfies StripTone[]
const number = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

/** The activity an event carries, or undefined when its data is not one. */
export function readActivity(data: Record<string, unknown>): AgentActivity | undefined {
  const { tool, message, state } = data
  if (typeof tool !== "string" || typeof message !== "string" || typeof state !== "string" || !STATES.includes(state)) return undefined
  const progress = number(data.progress)
  const total = number(data.total)
  return { tool, message, state: state as StripTone, ...(progress === undefined ? {} : { progress }), ...(total === undefined ? {} : { total }) }
}

/** "Agent: Routing: 3 of 8 connections"; an ended call says so after its line. */
export function stripText(activity: AgentActivity): string {
  return activity.state === "done" ? `Agent: ${activity.message}: done` : `Agent: ${activity.message}`
}

/** The share done, held to 0..1, when the activity has a positive total and a progress. */
function fractionOf(activity: AgentActivity): number | undefined {
  if (activity.state !== "running" || activity.progress === undefined || activity.total === undefined || activity.total <= 0) return undefined
  return Math.min(1, Math.max(0, activity.progress / activity.total))
}

/** The strip after an activity at `now`: the newest activity replaces whatever was shown. */
export function afterActivity(activity: AgentActivity, now: number): StripState {
  const fraction = fractionOf(activity)
  const strip: AgentStripView = { text: stripText(activity), tone: activity.state, ...(fraction === undefined ? {} : { fraction }) }
  if (activity.state === "failed") return { strip }
  return { strip, hideAt: now + (activity.state === "done" ? DONE_SHOWN_MS : RUNNING_STALE_MS) }
}

/** The strip at `now`: gone once its time is up. */
export function afterTime(state: StripState, now: number): StripState {
  return state.hideAt !== undefined && now >= state.hideAt ? NO_STRIP : state
}

/** A click dismisses a failure; the other strips stay, as they go by themselves. */
export function afterClick(state: StripState): StripState {
  return state.strip?.tone === "failed" ? NO_STRIP : state
}

/** The wait until the strip goes, from `now`; undefined when it waits for no time. */
export function msUntilHide(state: StripState, now: number): number | undefined {
  return state.hideAt === undefined ? undefined : Math.max(0, state.hideAt - now)
}
