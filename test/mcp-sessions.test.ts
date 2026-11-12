import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SessionTable, type SessionLimits } from "../src/hosted/mcp-sessions.js"

const LIMITS: SessionLimits = { maxSessions: 4, maxPerUser: 4, idleMs: 10_000, lifetimeMs: 60_000 }
let closed: string[]

beforeEach(() => {
  vi.useFakeTimers()
  closed = []
})
afterEach(() => vi.useRealTimers())

function open(table: SessionTable, user: string, id: string): void {
  table.reserve(user).commit(id, () => closed.push(id))
}

describe("MCP session table", () => {
  test("reservations count before registration, so concurrent initialises cannot pass the cap together", () => {
    const table = new SessionTable({ ...LIMITS, maxPerUser: 2 })
    const first = table.reserve("a")
    const second = table.reserve("a")
    expect(() => table.reserve("a")).toThrow("Too many open sessions for this user")
    second.release()
    second.release()
    const third = table.reserve("a")
    first.commit("s1", () => closed.push("s1"))
    third.commit("s3", () => closed.push("s3"))
    expect(table.size).toBe(2)
  })

  test("a released reservation frees its slot; a commit after release registers nothing", () => {
    const table = new SessionTable({ ...LIMITS, maxPerUser: 1 })
    const failed = table.reserve("a")
    failed.release()
    failed.commit("ghost", () => undefined)
    expect(table.size).toBe(0)
    open(table, "a", "s1")
    expect(table.size).toBe(1)
  })

  test("every session closes at its absolute lifetime, even with a stream open", () => {
    const table = new SessionTable(LIMITS)
    open(table, "a", "s1")
    table.streamOpened("s1")
    vi.advanceTimersByTime(59_000)
    expect(table.size).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(table.size).toBe(0)
    expect(closed).toEqual(["s1"])
  })

  test("a session with an open stream does not idle out; it does once the stream closes", () => {
    const table = new SessionTable(LIMITS)
    open(table, "a", "s1")
    table.streamOpened("s1")
    vi.advanceTimersByTime(30_000)
    expect(table.size).toBe(1)
    table.streamClosed("s1")
    vi.advanceTimersByTime(10_000)
    expect(closed).toEqual(["s1"])
  })

  test("a full server evicts the longest-idle session of a user above their fair share, not a fair user's", () => {
    const table = new SessionTable(LIMITS)
    open(table, "hog", "h1")
    vi.advanceTimersByTime(10)
    open(table, "hog", "h2")
    open(table, "hog", "h3")
    for (const id of ["h1", "h2", "h3"]) table.streamOpened(id)
    vi.advanceTimersByTime(10)
    open(table, "fair", "f1")
    table.streamOpened("f1")
    open(table, "new", "n1")
    expect(closed).toEqual(["h1"])
    expect(table.userOf("f1")).toBe("fair")
    expect(table.size).toBe(4)
  })

  test("a full server where nobody is above their share answers 429 and closes nothing", () => {
    const table = new SessionTable({ ...LIMITS, maxSessions: 2 })
    open(table, "a", "a1")
    open(table, "b", "b1")
    expect(() => table.reserve("c")).toThrow("Too many open sessions")
    expect(closed).toEqual([])
  })
})
