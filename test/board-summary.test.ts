import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { buildDesign } from "../src/engine/design.js"
import { BOARD_SUMMARY_LIMIT, formatBoardSummary } from "../src/mcp/board-summary.js"
import { benchmarkUnplaced, BENCHMARK_MAIN, CAN_FOLDER, CAN_MAIN, filesIn } from "./helpers/place-fixtures.js"

const DEMO_FOLDER = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const lines = (text: string) => text.split("\n")

describe("board_summary", () => {
  test("the small demo board fits and names every part", () => {
    const design = buildDesign(filesIn(DEMO_FOLDER), "index.circuit.tsx")
    const text = formatBoardSummary("index.circuit.tsx", design, new Set([design.pcb.parts[0]?.component as string]))
    expect(lines(text).length).toBeLessThanOrEqual(BOARD_SUMMARY_LIMIT)
    expect(lines(text)[0]).toMatch(/^index\.circuit\.tsx: Board [\d.]+ × [\d.]+ mm, 2 layers, courtyards use \d+%; \d+ parts?, \d+ nets?$/)
    for (const part of design.pcb.parts) expect(text).toMatch(new RegExp(`^${part.component} `, "m"))
    expect(text).toMatch(/ \[LOCKED\]$/m)
    expect(text).not.toMatch(/more parts/)
    expect(text).toMatch(/^Unrouted: \d+ connections?$/m)
  })

  test("the CAN module: placed parts as positions, at most 60 lines", () => {
    const design = buildDesign(filesIn(CAN_FOLDER), CAN_MAIN)
    const text = formatBoardSummary(CAN_MAIN, design, new Set())
    expect(lines(text).length).toBeLessThanOrEqual(BOARD_SUMMARY_LIMIT)
    expect(text).toMatch(/^U\d+ \S+ \S+ @\(-?[\d.]+, -?[\d.]+\) r\d+ (top|bottom)$/m)
    expect(text).toMatch(/^Pours: /m)
  })

  test("the 200-part benchmark is cut at 60 lines and detail full lists every part", () => {
    const design = buildDesign(benchmarkUnplaced(), BENCHMARK_MAIN)
    const text = formatBoardSummary(BENCHMARK_MAIN, design, new Set())
    expect(lines(text).length).toBe(BOARD_SUMMARY_LIMIT)
    expect(text).toMatch(/^… and \d+ more parts \(detail: full\)$/m)
    expect(text).toMatch(/^Longest unrouted connections \(10 of \d+\):$/m)
    expect(text).toMatch(/^C1 1uF 0603 not placed$/m)
    const full = formatBoardSummary(BENCHMARK_MAIN, design, new Set(), "full")
    expect(lines(full).length).toBeGreaterThan(200)
    expect(full).not.toMatch(/more parts/)
    for (const part of design.pcb.parts) expect(full).toMatch(new RegExp(`^${part.component} `, "m"))
  }, 60_000)
})
