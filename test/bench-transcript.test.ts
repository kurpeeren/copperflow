import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseTranscript, parseProjectStatus, countInstances, parseBoardSize } from "../bench/lib.mjs"

const SAMPLE = readFileSync(join(import.meta.dirname, "fixtures", "bench", "sample.jsonl"), "utf8")
const REFUSAL =
  "Part R9 is not known: the parts are R1, R2. Nothing was written. This sentence is long enough to be cut at one hundred and twenty characters exactly here."

describe("parseTranscript", () => {
  const counts = parseTranscript(SAMPLE)

  it("counts every tool call and the calls per tool, without the server prefix", () => {
    expect(counts.toolCalls).toBe(5)
    expect(counts.callsPerTool).toEqual({ project_status: 1, guide: 2, new_circuit: 1, Bash: 1 })
  })

  it("lists each refused call with the first 120 characters of its answer", () => {
    expect(counts.refused).toEqual([
      { tool: "new_circuit", text: REFUSAL.slice(0, 120) },
      { tool: "Bash", text: "Permission denied" },
    ])
  })

  it("says whether guide was called and with which topics", () => {
    expect(counts.guideCalled).toBe(true)
    expect(counts.guideTopics).toEqual(["planning", "routing", "blocks"])
  })

  it("adds up the characters of the tool answers", () => {
    expect(counts.toolAnswerChars).toBe(18 + 11 + 11 + REFUSAL.length + 17)
  })

  it("takes turns, tokens, cost and time from the result line", () => {
    expect(counts.turns).toBe(6)
    expect(counts.inputTokens).toBe(420)
    expect(counts.outputTokens).toBe(40)
    expect(counts.costUsd).toBeCloseTo(0.0123)
    expect(counts.durationMs).toBe(61000)
    expect(counts.ended).toBe("finished")
  })

  it("keeps what the run was given at the start: tools, servers, skills and plugins", () => {
    expect(counts.init?.tools).toHaveLength(3)
    expect(counts.init?.mcpServers).toEqual([{ name: "copperflow", status: "connected" }])
    expect(counts.init?.skills).toEqual([])
  })

  it("reports n/a values and an unfinished end when the stream stops before a result", () => {
    const cut = SAMPLE.split("\n").slice(0, 3).join("\n")
    const partial = parseTranscript(cut)
    expect(partial.toolCalls).toBe(1)
    expect(partial.turns).toBeNull()
    expect(partial.costUsd).toBeNull()
    expect(partial.ended).toBe("no result")
  })

  it("skips lines that are not JSON", () => {
    expect(parseTranscript(`not json\n${SAMPLE}`).toolCalls).toBe(5)
  })

  it("marks a result that reports an error", () => {
    const bad = parseTranscript('{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":3}')
    expect(bad.ended).toBe("error: error_max_turns")
  })
})

describe("measurement parsers", () => {
  it("reads the counts per circuit from project_status", () => {
    const text = [
      "No PROJECT.md yet: write the Intent and Blocks with set_project.",
      "Circuits (2):",
      "a.circuit.tsx: parts 9, nets 6, unplaced 0, unrouted 22, errors 0, warnings 1",
      "  c0003 2026-11-16 something",
      "b.circuit.tsx: could not be built: boom",
    ].join("\n")
    expect(parseProjectStatus(text)).toEqual([
      { file: "a.circuit.tsx", parts: 9, nets: 6, unplaced: 0, unrouted: 22, errors: 0, warnings: 1 },
      { file: "b.circuit.tsx", error: "could not be built: boom" },
    ])
  })

  it("counts sheet instances in a summary", () => {
    const text = [
      "io.circuit.tsx: 3 parts, 3 traces",
      "Parts:",
      "  J1 <pinheader> pinCount={3}",
      '  CH1 <Input> connections={{ IN: "IN1" }} (code: set_props cannot change it) base={100}',
      '  CH2 <Input> connections={{ IN: "IN2" }} (code: set_props cannot change it) base={200}',
    ].join("\n")
    expect(countInstances(text)).toBe(2)
  })

  it("reads the board size from board_summary", () => {
    expect(parseBoardSize("x.circuit.tsx: Board 30.0 × 18.0 mm, 2 layers")).toEqual({ width: 30, height: 18 })
    expect(parseBoardSize("no board here")).toBeNull()
  })
})
