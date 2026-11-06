import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { checkDesign, mergeViolations } from "../../src/engine/checks/index.js"
import { violation, type Violation } from "../../src/engine/checks/violation.js"
import { buildDesign } from "../../src/engine/design.js"
import { FOOTPRINT_FILE } from "../../src/engine/engine.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"

const MAIN = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))

const board = (body: string) => buildDesign({ [MAIN]: `export default () => (<board width="20mm" height="20mm">${body}</board>)` }, MAIN)

/** Two resistors a hair apart (a placement error), one floating pin (an electrical error). */
const CROWDED = board(
  `<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
   <resistor name="R2" resistance="1k" footprint="0603" pcbX={0.5} pcbY={0} />
   <trace from=".R1 > .pin1" to="net.GND" />`,
)

describe("buildDesign violations", () => {
  test("every build carries them, from both the electrical and the placement checks", () => {
    const codes = new Set(CROWDED.violations.map((v) => v.code))
    expect(codes.has("pin-unconnected")).toBe(true)
    expect([...codes].some((code) => CROWDED.violations.find((v) => v.code === code)?.view === "pcb")).toBe(true)
  })

  test("equal what checkDesign finds on the built parts", () => {
    expect(CROWDED.violations).toEqual(checkDesign(CROWDED.circuit, CROWDED.schematic, CROWDED.pcb, CROWDED.rules))
  })

  test("are plain JSON, so the design still survives structuredClone", () => {
    expect(structuredClone(CROWDED)).toEqual(CROWDED)
  })

  test("are sorted: errors first, then code, then id, in natural order", () => {
    const { violations } = CROWDED
    const severities = violations.map((v) => (v.severity === "error" ? 0 : 1))
    expect(severities).toEqual([...severities].sort((a, b) => a - b))
    expect(violations.length).toBeGreaterThan(1)
    for (const [i, v] of violations.entries()) {
      const next = violations[i + 1]
      if (!next || v.severity !== next.severity) continue
      expect(v.code.localeCompare(next.code, "en", { numeric: true })).toBeLessThanOrEqual(0)
    }
  })

  test("have unique ids", () => {
    const ids = CROWDED.violations.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("a part auto-placed on a board of no size is reported as unchecked, not thrown over", () => {
    const built = buildDesign({ [MAIN]: `export default () => (<board><chip name="U1" footprint="sot23_5" /></board>)` }, MAIN)
    expect(built.violations).toContainEqual(expect.objectContaining({ id: "unchecked:U1", severity: "warning", items: ["U1"] }))
  })

  test("the usb-c-ldo example carries no checking failure of its own", async () => {
    const files = await collectProjectFiles(EXAMPLE, { include: FOOTPRINT_FILE })
    const built = buildDesign(files, "index.circuit.tsx")
    expect(built.violations.filter((v) => v.code === "unchecked" && v.message.includes("bug in the checks"))).toEqual([])
  })
})

describe("mergeViolations", () => {
  const make = (code: string, severity: "error" | "warning", item: string): Violation => violation(code, severity, `${code} ${item}`, [item], "pcb")

  test("sorts errors before warnings, then by code, then by id, naturally", () => {
    const merged = mergeViolations([make("b", "warning", "x"), make("c", "error", "x"), make("a", "warning", "x10"), make("a", "warning", "x9"), make("a", "error", "x")])
    expect(merged.map((v) => v.id)).toEqual(["a:x", "c:x", "a:x9", "a:x10", "b:x"])
  })

  test("keeps the first violation of an id and adds one unchecked warning naming it", () => {
    const first = make("clash", "error", "R1")
    const second = { ...first, message: "the second" }
    const merged = mergeViolations([first, second, { ...first, message: "the third" }])
    expect(merged.filter((v) => v.id === first.id)).toEqual([first])
    const warnings = merged.filter((v) => v.code === "unchecked")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ severity: "warning", id: `unchecked:${first.id}`, items: [first.id] })
    expect(warnings[0]?.message).toContain("bug in the checks")
    expect(warnings[0]?.message).toContain(first.id)
  })

  test("does not change the list it is given", () => {
    const input = [make("b", "warning", "x"), make("a", "error", "x")]
    const copy = structuredClone(input)
    mergeViolations(input)
    expect(input).toEqual(copy)
  })
})
