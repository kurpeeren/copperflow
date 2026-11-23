import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { buildDesign } from "../src/engine/design.js"
import { BOARD_SUMMARY_LIMIT, edgeDistance, formatBoardSummary } from "../src/mcp/board-summary.js"
import { benchmarkUnplaced, BENCHMARK_MAIN, CAN_FOLDER, CAN_MAIN, filesIn } from "./helpers/place-fixtures.js"

const DEMO_FOLDER = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const lines = (text: string) => text.split("\n")

describe("circuit_summary view board", () => {
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
    // The CAN module is placed clean: no finding line, and the design agrees.
    expect(lines(text).filter((l) => /^(Courtyards overlap|Off the board|Within the)/.test(l))).toEqual([])
    expect(design.violations.filter((v) => v.code === "courtyard-overlap" || v.code === "outside-board")).toEqual([])
    const outline = design.pcb.board?.outline ?? []
    for (const part of design.pcb.parts) expect(edgeDistance(part.courtyard, outline)).toBeGreaterThanOrEqual(design.rules.fabrication.boardEdgeClearance)
  })

  test("the longest connections name both pads and where they are, routed ones too, so a far crystal shows", () => {
    const folder = fileURLToPath(new URL("./fixtures/can-proof-3", import.meta.url))
    const design = buildDesign(filesIn(folder), CAN_MAIN)
    const text = formatBoardSummary(CAN_MAIN, design, new Set())
    expect(lines(text).length).toBeLessThanOrEqual(BOARD_SUMMARY_LIMIT)
    const longest = lines(text).filter((l) => /^ {2}\w+: /.test(l))
    expect(longest).toHaveLength(10)
    // The proof run routed every connection, yet the crystal's long lines are listed with both pads' places.
    const osc = longest.find((l) => l.startsWith("  OSC1: "))
    expect(osc).toMatch(/^ {2}OSC1: U1\.\S+ \(-?[\d.]+, -?[\d.]+ top\) to Y1\.\S+ \(-?[\d.]+, -?[\d.]+ through\) [\d.]+ mm$|^ {2}OSC1: Y1\.\S+ .* to U1\.\S+ .* [\d.]+ mm$/)
    // GND is poured on both layers: its routed lines say nothing about placement and are left out.
    expect(longest.some((l) => l.startsWith("  GND: "))).toBe(false)
  })

  test("the findings: overlapping courtyards, a part off the board and one within the edge clearance", () => {
    const r = (name: string, x: number, y: number) => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} />\n`
    const source = (x4: number) => `export default () => (\n  <board width="20mm" height="10mm">\n${r("R1", 0, 0)}${r("R2", 0.5, 0)}${r("R3", 30, 0)}${r("R4", x4, 0)}${r("R5", -5, 0)}  </board>\n)\n`
    const probe = buildDesign({ "f.circuit.tsx": source(5) }, "f.circuit.tsx").pcb.parts.find((p) => p.component === "R4")
    const reach = Math.max(...(probe?.courtyard ?? []).map((p) => p.x)) - 5
    // R4's courtyard ends 0.1 mm inside the right edge.
    const design = buildDesign({ "f.circuit.tsx": source(Math.round((10 - reach - 0.1) * 1000) / 1000) }, "f.circuit.tsx")
    const found = lines(formatBoardSummary("f.circuit.tsx", design, new Set())).filter((l) => /^(Courtyards overlap|Off the board|Within the)/.test(l))
    expect(found).toEqual(["Courtyards overlap (1): R1/R2", "Off the board (1): R3", `Within the ${design.rules.fabrication.boardEdgeClearance} mm edge clearance (1): R4`])
  })

  test("an outline corner poking into a courtyard counts as no clearance at all", () => {
    const courtyard = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const notched = [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: 6, y: 15 }, { x: 5, y: 5 }, { x: 4, y: 15 }, { x: -5, y: 15 }]
    expect(edgeDistance(courtyard, notched)).toBe(0)
    const near = [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: 6, y: 15 }, { x: 5, y: 10.2 }, { x: 4, y: 15 }, { x: -5, y: 15 }]
    expect(edgeDistance(courtyard, near)).toBeCloseTo(0.2, 9)
    expect(edgeDistance(courtyard, [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: -5, y: 15 }])).toBe(5)
  })

  test("the 200-part benchmark is cut at 60 lines and detail full lists every part", () => {
    const design = buildDesign(benchmarkUnplaced(), BENCHMARK_MAIN)
    const text = formatBoardSummary(BENCHMARK_MAIN, design, new Set())
    expect(lines(text).length).toBe(BOARD_SUMMARY_LIMIT)
    expect(text).toMatch(/^… and \d+ more parts \(detail: full\)$/m)
    // Nothing is placed: no connection has a length to tell, so none is listed.
    expect(text).not.toMatch(/^Longest connections/m)
    expect(text).toMatch(/^C1 1uF 0603 not placed$/m)
    const full = formatBoardSummary(BENCHMARK_MAIN, design, new Set(), "full")
    expect(lines(full).length).toBeGreaterThan(200)
    expect(full).not.toMatch(/more parts/)
    for (const part of design.pcb.parts) expect(full).toMatch(new RegExp(`^${part.component} `, "m"))
  }, 60_000)
})
