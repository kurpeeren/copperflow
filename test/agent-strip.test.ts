import { describe, expect, test } from "vitest"
import { afterActivity, afterClick, afterTime, DONE_SHOWN_MS, msUntilHide, NO_STRIP, readActivity, RUNNING_STALE_MS } from "../studio/src/shell/agent-strip.js"

const NOW = 1000

describe("the agent strip", () => {
  test("a running activity with a total shows its line and how far it is", () => {
    const state = afterActivity({ tool: "autoroute", message: "Routing: 3 of 8 connections, pass 2", progress: 3, total: 8, state: "running" }, NOW)
    expect(state.strip).toEqual({ text: "Agent: Routing: 3 of 8 connections, pass 2", tone: "running", fraction: 3 / 8 })
    expect(state.hideAt).toBe(NOW + RUNNING_STALE_MS)
  })

  test("a step without a total has no bar, and a count past its total is held to a full bar", () => {
    expect(afterActivity({ tool: "export_fabrication", message: "Writing the Gerbers", state: "running" }, NOW).strip?.fraction).toBeUndefined()
    expect(afterActivity({ tool: "autoplace", message: "x", progress: 9, total: 8, state: "running" }, NOW).strip?.fraction).toBe(1)
  })

  test("done says so and goes DONE_SHOWN_MS later", () => {
    const state = afterActivity({ tool: "autoroute", message: "autoroute amp.circuit.tsx", state: "done" }, NOW)
    expect(state.strip).toEqual({ text: "Agent: autoroute amp.circuit.tsx: done", tone: "done" })
    expect(msUntilHide(state, NOW)).toBe(DONE_SHOWN_MS)
    expect(afterTime(state, NOW + DONE_SHOWN_MS - 1)).toBe(state)
    expect(afterTime(state, NOW + DONE_SHOWN_MS)).toEqual(NO_STRIP)
  })

  test("failed stays until a click or the next activity", () => {
    const failed = afterActivity({ tool: "autoroute", message: "autoroute a.circuit.tsx: The circuit has no part U9.", state: "failed" }, NOW)
    expect(failed.strip?.tone).toBe("failed")
    expect(msUntilHide(failed, NOW)).toBeUndefined()
    expect(afterTime(failed, NOW + 10 * RUNNING_STALE_MS)).toBe(failed)
    expect(afterClick(failed)).toEqual(NO_STRIP)
    expect(afterActivity({ tool: "bom", message: "bom a.circuit.tsx", state: "running" }, NOW).strip?.tone).toBe("running")
  })

  test("a click leaves a running or done strip alone", () => {
    const running = afterActivity({ tool: "bom", message: "bom", state: "running" }, NOW)
    expect(afterClick(running)).toBe(running)
    expect(afterClick(NO_STRIP)).toBe(NO_STRIP)
  })

  test("event data that is not an activity is ignored; numbers that are not finite are dropped", () => {
    expect(readActivity({ tool: "x", message: "m", state: "sleeping" })).toBeUndefined()
    expect(readActivity({ tool: 1, message: "m", state: "done" })).toBeUndefined()
    expect(readActivity({ tool: "x", message: "m", state: "running", progress: Number.NaN, total: 4 })).toEqual({ tool: "x", message: "m", state: "running", total: 4 })
  })
})
