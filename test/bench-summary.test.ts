import { describe, expect, it } from "vitest"
import { summaryMarkdown, type RunResult } from "../bench/lib.mjs"

const finished: RunResult = {
  brief: "led-driver",
  model: "haiku",
  run: 1,
  ended: "finished",
  minutes: 4.25,
  transcript: {
    toolCalls: 20,
    refused: [
      { tool: "new_circuit", text: "Part R9 is not known" },
      { tool: "autoroute", text: "No board yet" },
    ],
    inputTokens: 120000,
    outputTokens: 3000,
  },
  project: { parts: 8, instances: 0, unrouted: 0, errors: 0, warnings: 2, fabFiles: true },
}

const timedOut: RunResult = {
  brief: "can-node",
  model: "haiku",
  run: 1,
  ended: "timed out",
  minutes: 15,
  transcript: { toolCalls: 31, refused: [{ tool: "new_circuit", text: "Net X has one pin" }], inputTokens: null, outputTokens: null },
  project: { parts: null, instances: null, unrouted: null, errors: null, warnings: null, fabFiles: false },
}

describe("summaryMarkdown", () => {
  const text = summaryMarkdown([finished, timedOut])
  const lines = text.split("\n")

  it("has a header and one row per run", () => {
    const header = lines.find((line) => line.startsWith("| brief"))
    expect(header).toBe(
      "| brief | model | run | ended | minutes | tool calls | refused | parts | instances | unrouted | errors | warnings | fab files | tokens in/out |",
    )
    expect(lines.filter((line) => line.startsWith("| led-driver") || line.startsWith("| can-node"))).toHaveLength(2)
  })

  it("writes the measured numbers of a run", () => {
    expect(lines).toContain("| led-driver | haiku | 1 | finished | 4.3 | 20 | 2 | 8 | 0 | 0 | 0 | 2 | yes | 120000/3000 |")
  })

  it("writes n/a where nothing was measured", () => {
    expect(lines).toContain("| can-node | haiku | 1 | timed out | 15.0 | 31 | 1 | n/a | n/a | n/a | n/a | n/a | no | n/a |")
  })

  it("groups the refusals by tool under the table", () => {
    const refusals = text.slice(text.indexOf("## Refusals"))
    expect(refusals).toContain("### new_circuit (2)")
    expect(refusals).toContain("- led-driver run 1: Part R9 is not known")
    expect(refusals).toContain("- can-node run 1: Net X has one pin")
    expect(refusals).toContain("### autoroute (1)")
    expect(refusals.indexOf("### new_circuit")).toBeLessThan(refusals.indexOf("### autoroute"))
  })

  it("says so when no call was refused", () => {
    const clean = summaryMarkdown([{ ...finished, transcript: { ...finished.transcript, refused: [] } }])
    expect(clean).toContain("No call was refused.")
  })
})
