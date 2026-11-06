import { describe, expect, test } from "vitest"
import type { Violation } from "../src/engine/checks/violation.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import type { Diagnostic, Point, Severity } from "../src/engine/model.js"
import { checkCounts, checkGroups, checkRows, checkSummary, markersFor, partOf, type CheckRow } from "../studio/src/checks-list.js"

const FILE = "main.circuit.tsx"

function violation(code: string, severity: Severity, items: string[], view: "pcb" | "schematic", at?: Point): Violation {
  return { id: `${code}:${items.join(",")}`, code, severity, message: `${code} message`, items, view, ...(at ? { at } : {}) }
}

const diagnostic = (code: string, severity: Severity, items: string[]): Diagnostic => ({ code, severity, message: `${code} message`, items })
const designWith = (violations: Violation[], diagnostics: Diagnostic[]) => ({ violations, diagnostics }) as unknown as Design
const rowOf = (items: string[], extra: Partial<CheckRow> = {}): CheckRow => ({ id: "x", severity: "error", code: "x", message: "", items, view: "pcb", ...extra })

describe("checkRows", () => {
  const design = designWith(
    [violation("unrouted", "warning", [], "pcb"), violation("courtyard-overlap", "error", ["R1", "R2"], "pcb", { x: 1, y: 2 })],
    [diagnostic("unknown-prop", "warning", ["R1.foo"]), diagnostic("bad-footprint", "error", ["U1"])],
  )

  test("puts errors first, violations before diagnostics within each severity", () => {
    expect(checkRows(design).map((r) => [r.severity, r.code])).toEqual([
      ["error", "courtyard-overlap"],
      ["error", "bad-footprint"],
      ["warning", "unrouted"],
      ["warning", "unknown-prop"],
    ])
  })

  test("maps diagnostics to the code view without a position", () => {
    const rows = checkRows(design).filter((r) => r.code === "bad-footprint" || r.code === "unknown-prop")
    expect(rows.map((r) => r.view)).toEqual(["code", "code"])
    expect(rows.every((r) => r.at === undefined)).toBe(true)
  })

  test("keeps a violation's id, view and position, and names its part", () => {
    const overlap = checkRows(design)[0]
    expect(overlap).toEqual({
      id: "courtyard-overlap:R1,R2",
      severity: "error",
      code: "courtyard-overlap",
      message: "courtyard-overlap message",
      items: ["R1", "R2"],
      view: "pcb",
      at: { x: 1, y: 2 },
      part: "R1",
    })
  })

  test("gives every row its own id, also two diagnostics with the same code and items", () => {
    const twice = designWith([], [diagnostic("parse", "error", []), diagnostic("parse", "error", [])])
    const ids = checkRows(twice).map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
  })

  test("a row without a component has no part", () => {
    expect(checkRows(design).find((r) => r.code === "unrouted")).not.toHaveProperty("part")
  })

  test("two parts on one spot give a courtyard-overlap error with a position, among the errors first", () => {
    const built = buildDesign(
      {
        [FILE]: `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={0} pcbY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin2" />
  </board>
)`,
      },
      FILE,
    )
    const rows = checkRows(built)
    const overlap = rows.find((r) => r.code === "courtyard-overlap")
    expect(overlap).toMatchObject({ severity: "error", view: "pcb", part: "R1" })
    expect(overlap?.at).toBeDefined()
    const severities = rows.map((r) => r.severity)
    expect(severities).toEqual([...severities].sort())
  })

  test("an empty design has no rows", () => {
    expect(checkRows(designWith([], []))).toEqual([])
  })
})

describe("checkGroups", () => {
  test("groups rows by code in row order, with their rows", () => {
    const rows = checkRows(
      designWith(
        [
          violation("pin-unconnected", "error", ["U1.pin1"], "schematic"),
          violation("courtyard-overlap", "error", ["R1", "R2"], "pcb"),
          violation("pin-unconnected", "warning", ["R3.pin2"], "schematic"),
          violation("pin-unconnected", "error", ["U1.pin2"], "schematic"),
        ],
        [],
      ),
    )
    const groups = checkGroups(rows)
    expect(groups.map((g) => [g.code, g.severity, g.rows.length])).toEqual([
      ["pin-unconnected", "error", 3],
      ["courtyard-overlap", "error", 1],
    ])
  })

  test("a group of warnings is a warning", () => {
    const rows = checkRows(designWith([violation("unrouted", "warning", [], "pcb")], []))
    expect(checkGroups(rows)).toEqual([{ code: "unrouted", severity: "warning", rows }])
  })

  test("no rows give no groups", () => {
    expect(checkGroups([])).toEqual([])
  })
})

describe("partOf", () => {
  test("picks the component of the first pad", () => {
    expect(partOf(rowOf(["R1#1", "R2#2"]))).toBe("R1")
  })

  test("skips named nets and takes the component of a pin", () => {
    expect(partOf(rowOf(["net.GND", "U1.pin3"]))).toBe("U1")
  })

  test("skips keepouts, and a plain item is a component", () => {
    expect(partOf(rowOf(["keepout:1", "R1"]))).toBe("R1")
  })

  test("skips unnamed nets and whole violation ids", () => {
    expect(partOf(rowOf(["net:R1.pin1"]))).toBeUndefined()
    expect(partOf(rowOf(["courtyard-overlap:R1,R2"]))).toBeUndefined()
  })

  test("keeps the suffix of a repeated name", () => {
    expect(partOf(rowOf(["R1~2#1"]))).toBe("R1~2")
  })

  test("a row without items has no part", () => {
    expect(partOf(rowOf([]))).toBeUndefined()
  })
})

describe("markersFor", () => {
  const rows = checkRows(
    designWith(
      [
        violation("courtyard-overlap", "error", ["R1", "R2"], "pcb", { x: 1, y: 2 }),
        violation("unrouted", "warning", [], "pcb"),
        violation("pin-unconnected", "warning", ["U1.pin1"], "schematic", { x: 3, y: 4 }),
      ],
      [diagnostic("bad-footprint", "error", ["U1"])],
    ),
  )

  test("gives the view's rows that have a position", () => {
    expect(markersFor(rows, "pcb")).toEqual([{ id: "courtyard-overlap:R1,R2", at: { x: 1, y: 2 }, severity: "error" }])
    expect(markersFor(rows, "schematic")).toEqual([{ id: "pin-unconnected:U1.pin1", at: { x: 3, y: 4 }, severity: "warning" }])
  })
})

describe("checkCounts and checkSummary", () => {
  test("count errors and warnings over violations and diagnostics", () => {
    const rows = checkRows(
      designWith([violation("courtyard-overlap", "error", ["R1", "R2"], "pcb"), violation("unrouted", "warning", [], "pcb")], [diagnostic("bad-footprint", "error", ["U1"])]),
    )
    expect(checkCounts(rows)).toEqual({ errors: 2, warnings: 1 })
  })

  test("say the counts in short words", () => {
    expect(checkSummary({ errors: 0, warnings: 0 })).toBe("No problems found.")
    expect(checkSummary({ errors: 1, warnings: 0 })).toBe("1 error")
    expect(checkSummary({ errors: 0, warnings: 3 })).toBe("3 warnings")
    expect(checkSummary({ errors: 2, warnings: 1 })).toBe("2 errors, 1 warning")
  })
})
