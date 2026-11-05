import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { CircuitCodeError } from "../../src/engine/evaluate.js"
import { BOARD } from "../fixtures.js"

const SHARED = `export const regulatorProps = { footprint: "sot23_5", pinCount: 5 }; export const offset = 1`

const chipWith = (path: string) =>
  `export default () => (<board width="10mm" height="10mm"><chip name="U1" footprint="${path}" pinCount={2} /></board>)`

const FOOTPRINT_YAML = [
  "pads:",
  "  - { number: '1', shape: rect, x: -1, y: 0, width: 1, height: 1 }",
  "  - { number: '2', shape: rect, x: 1, y: 0, width: 1, height: 1 }",
  "",
].join("\n")

describe("buildDesign", () => {
  const design = buildDesign({ "main.circuit.tsx": BOARD, "shared.ts": SHARED }, "main.circuit.tsx")

  test("builds the circuit, both layouts and the diagnostics of every step", () => {
    expect(design.version).toBe(1)
    expect(design.file).toBe("main.circuit.tsx")
    expect(design.circuit.components.map((c) => c.id)).toEqual(["R1", "C1", "LED1", "RX", "RX~2", "U1", "R9"])
    expect(design.pcb.ratsnest.length).toBeGreaterThan(0)
    expect(design.diagnostics.filter((d) => d.code === "duplicate-name" && d.severity === "error")).toHaveLength(1)
    const missing = design.diagnostics.filter((d) => d.code === "no-footprint")
    expect(missing).toHaveLength(1)
    expect(missing[0]?.severity).toBe("warning")
    expect(missing[0]?.items).toEqual(["LED1", "R9", "RX", "RX~2"])
  })

  test("is plain JSON, so it crosses the worker boundary unchanged", () => {
    expect(structuredClone(design)).toEqual(design)
  })

  test("puts elaboration diagnostics before layout diagnostics", () => {
    const codes = design.diagnostics.map((d) => d.code)
    expect(codes.indexOf("duplicate-name")).toBeLessThan(codes.indexOf("no-footprint"))
  })

  test("throws a CircuitCodeError for a syntax error", () => {
    expect(() => buildDesign({ "main.circuit.tsx": "export default () => (<board" }, "main.circuit.tsx")).toThrow(CircuitCodeError)
  })

  test("reads a footprint file from the project files", () => {
    const files = { "m.circuit.tsx": chipWith("parts/x/footprint.yaml"), "parts/x/footprint.yaml": FOOTPRINT_YAML }
    const built = buildDesign(files, "m.circuit.tsx")
    expect(built.pcb.parts[0]?.pads).toHaveLength(2)
  })

  test("reports a footprint file that is not in the project files", () => {
    const built = buildDesign({ "m.circuit.tsx": chipWith("parts/x/footprint.yaml") }, "m.circuit.tsx")
    expect(built.diagnostics.some((d) => d.severity === "error" || d.severity === "warning")).toBe(true)
  })
})
