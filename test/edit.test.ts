import { describe, expect, test } from "vitest"
import { applyEdits, EditError } from "../src/core/edit.js"
import { analyzeCircuit } from "../src/core/analyze.js"
import { BOARD } from "./fixtures.js"

const none = new Set<string>()

function expectEditError(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(EditError)
    expect((error as EditError).code).toBe(code)
    return
  }
  throw new Error(`expected EditError ${code}`)
}

describe("setProps", () => {
  test("replaces a literal and leaves every other byte unchanged", () => {
    const out = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { pcbX: 7.5 } }], none)
    expect(out).toBe(BOARD.replace("pcbX={-4}", "pcbX={7.5}"))
  })

  test("writes strings as plain attributes and negative numbers in braces", () => {
    const out = applyEdits(
      BOARD,
      [{ kind: "setProps", part: "R1", props: { resistance: "10k", pcbY: -1 } }],
      none,
    )
    expect(out).toContain('resistance="10k"')
    expect(out).toContain("pcbY={-1}")
  })

  test("uses braces for strings containing quotes", () => {
    const out = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { footprint: 'a"b' } }], none)
    expect(out).toContain('footprint={"a\\"b"}')
  })

  test("adds a missing prop on the same line for one-line elements", () => {
    const out = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { pcbRotation: 90 } }], none)
    expect(out).toContain('pcbY={2} pcbRotation={90} />')
  })

  test("adds a missing prop on its own line for multi-line elements", () => {
    const out = applyEdits(BOARD, [{ kind: "setProps", part: "C1", props: { pcbY: -2 } }], none)
    expect(out).toContain("      pcbX={3}\n      pcbY={-2}\n    />")
  })

  test("refuses locked parts", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], new Set(["R1"])), "locked")
  })

  test("refuses read-only parts and read-only props", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "RX", props: { pcbX: 1 } }], none), "readonly")
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "LED1", props: { pcbX: 1 } }], none), "readonly")
  })

  test("refuses unknown parts, renames and invalid values", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "Q9", props: { pcbX: 1 } }], none), "not_found")
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { name: "R2" } }], none), "invalid")
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { pcbX: Number.NaN } }], none), "invalid")
    expectEditError(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { "bad-key": 1 } }], none), "invalid")
  })
})

describe("traces", () => {
  test("adds a trace before the closing board tag with matching indentation", () => {
    const out = applyEdits(BOARD, [{ kind: "addTrace", from: ".LED1 > .pin1", to: "net.GND" }], none)
    expect(out).toContain('    <trace from=".C1 > .pin1" to=".R1 > .pin2" />\n    <trace from=".LED1 > .pin1" to="net.GND" />\n  </board>')
  })

  test("writes the corners of a hand-drawn schematic wire, rounded", () => {
    const corners = [
      { x: 1, y: -2.5 },
      { x: 3.123456, y: -2.5 },
    ]
    const out = applyEdits(BOARD, [{ kind: "addTrace", from: ".LED1 > .pin1", to: "net.GND", schematicRouteHints: corners }], none)
    expect(out).toContain('<trace from=".LED1 > .pin1" to="net.GND" schematicRouteHints={[{ x: 1, y: -2.5 }, { x: 3.1235, y: -2.5 }]} />')
  })

  test("refuses corners that are not finite numbers or too many", () => {
    const add = (corners: unknown) => () =>
      applyEdits(BOARD, [{ kind: "addTrace", from: ".LED1 > .pin1", to: "net.GND", schematicRouteHints: corners as { x: number; y: number }[] }], none)
    expectEditError(add([{ x: Number.NaN, y: 0 }]), "invalid")
    expectEditError(add([{ x: "1", y: 0 }]), "invalid")
    expectEditError(add(Array.from({ length: 201 }, () => ({ x: 0, y: 0 }))), "invalid")
    expectEditError(add([{ x: 1e305, y: 0 }]), "invalid")
  })

  test("adds extra literal props to a new trace", () => {
    const out = applyEdits(BOARD, [{ kind: "addTrace", from: ".R1 > .pin2", to: "net.V3_3", props: { thickness: "0.4mm" } }], none)
    expect(out).toContain('<trace from=".R1 > .pin2" to="net.V3_3" thickness="0.4mm" />')
  })

  test("removes a trace in either direction", () => {
    const out = applyEdits(BOARD, [{ kind: "removeTrace", from: ".R1 > .pin2", to: ".C1 > .pin1" }], none)
    expect(out).not.toContain(".C1 > .pin1")
    expect(analyzeCircuit(out).traces).toHaveLength(1)
  })

  test("refuses to remove a trace touching a locked part", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "removeTrace", from: ".R1 > .pin1", to: "net.GND" }], new Set(["R1"])), "locked")
  })

  test("reports a missing trace", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "removeTrace", from: ".X > .a", to: "net.GND" }], none), "not_found")
  })
})

describe("removePart", () => {
  test("removes the element lines and its traces", () => {
    const out = applyEdits(BOARD, [{ kind: "removePart", part: "C1" }], none)
    expect(out).not.toContain("C1")
    expect(out).toContain('pcbY={2} />\n    <led name="LED1"')
    const model = analyzeCircuit(out)
    expect(model.traces.map((t) => t.to)).toEqual(["net.GND"])
  })

  test("refuses locked parts", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "removePart", part: "C1" }], new Set(["C1"])), "locked")
  })
})

describe("edge cases", () => {
  test("gives a value to a valueless attribute", () => {
    const out = applyEdits('<board>\n  <led name="D1" doNotPlace />\n</board>', [{ kind: "setProps", part: "D1", props: { doNotPlace: false } }], none)
    expect(out).toContain("doNotPlace={false}")
  })

  test("rejects traces without a usable board or with bad arguments", () => {
    expectEditError(() => applyEdits('<group><led name="D1" /></group>', [{ kind: "addTrace", from: ".D1 > .pin1", to: "net.GND" }], none), "invalid")
    expectEditError(() => applyEdits('<board><led name="D1" /></board>', [{ kind: "addTrace", from: ".D1 > .pin1", to: "net.GND" }], none), "invalid")
    expectEditError(() => applyEdits(BOARD, [{ kind: "addTrace", from: " ", to: "net.GND" }], none), "invalid")
    expectEditError(() => applyEdits(BOARD, [{ kind: "addTrace", from: ".R1 > .pin1", to: "net.GND", props: { from: "x" } }], none), "invalid")
  })

  test("refuses a trace that already exists, in either direction and either selector form", () => {
    expectEditError(() => applyEdits(BOARD, [{ kind: "addTrace", from: ".R1 > .pin1", to: "net.GND" }], none), "invalid")
    expectEditError(() => applyEdits(BOARD, [{ kind: "addTrace", from: "R1.pin2", to: "C1.pin1" }], none), "invalid")
    expect(() => applyEdits(BOARD, [{ kind: "addTrace", from: ".R1 > .pin2", to: "net.GND" }], none)).not.toThrow()
  })

  test("refuses to remove a read-only trace", () => {
    const source = '<board>\n  <trace from={a} to="net.GND" />\n  <trace from={a} to={b} />\n</board>'
    const model = analyzeCircuit(source)
    expect(model.traces.map((t) => t.readonlyReason)).toEqual(["from or to is not a string literal", "from or to is not a string literal"])
    const inLoop = '<board>\n  {[1].map(() => <trace from=".A > .pin1" to="net.GND" />)}\n</board>'
    expectEditError(() => applyEdits(inLoop, [{ kind: "removeTrace", from: ".A > .pin1", to: "net.GND" }], none), "readonly")
  })

  test("reports source that cannot be parsed", () => {
    expectEditError(() => applyEdits("<board>", [{ kind: "removePart", part: "R1" }], none), "parse")
  })

  test("duplicate part names are listed as skipped", () => {
    const model = analyzeCircuit('<board>\n  <led name="D1" />\n  <led name="D1" />\n</board>')
    expect(model.parts).toHaveLength(1)
    expect(model.skipped).toEqual([{ tag: "led", line: 3, reason: "duplicate name D1" }])
  })
})

describe("lock and encoding safety", () => {
  const GROUP = '<board>\n  <group name="G1">\n    <resistor name="R3" />\n  </group>\n  <led name="D1" />\n  <trace from=".D1 > .pin1" to=".R3 > .pin1" />\n</board>\n'

  test("removing a container refuses when a locked part is inside it", () => {
    expectEditError(() => applyEdits(GROUP, [{ kind: "removePart", part: "G1" }], new Set(["R3"])), "locked")
  })

  test("removing a part refuses when one of its traces touches a locked part", () => {
    expectEditError(() => applyEdits(GROUP, [{ kind: "removePart", part: "D1" }], new Set(["R3"])), "locked")
  })

  test("removing a part refuses when one of its traces is read-only", () => {
    const source = '<board>\n  <led name="D1" />\n  {[1].map(() => <trace from=".D1 > .pin1" to="net.GND" />)}\n</board>\n'
    expectEditError(() => applyEdits(source, [{ kind: "removePart", part: "D1" }], none), "readonly")
  })

  test("strings with & are written in braces so entities survive", () => {
    const out = applyEdits(GROUP, [{ kind: "setProps", part: "D1", props: { color: "&amp;" } }], none)
    expect(out).toContain('color={"&amp;"}')
    expect(analyzeCircuit(out).parts.find((p) => p.name === "D1")?.props.color?.literal).toBe("&amp;")
  })

  test("CRLF files keep CRLF line endings", () => {
    const crlf = BOARD.replace(/\n/g, "\r\n")
    const out = applyEdits(
      crlf,
      [
        { kind: "setProps", part: "C1", props: { pcbY: 1 } },
        { kind: "addTrace", from: ".LED1 > .pin1", to: "net.GND" },
      ],
      none,
    )
    expect(out.replace(/\r\n/g, "")).not.toContain("\n")
  })

  test("prototype-like prop names are rejected", () => {
    expectEditError(() => applyEdits(GROUP, [{ kind: "setProps", part: "D1", props: { __proto__x: 1, ["__proto__"]: 1 } }], none), "invalid")
  })
})

test("applies several edits in order", () => {
  const out = applyEdits(
    BOARD,
    [
      { kind: "setProps", part: "R1", props: { pcbX: 0 } },
      { kind: "removePart", part: "LED1" },
    ],
    none,
  )
  expect(out).toContain("pcbX={0}")
  expect(out).not.toContain("LED1")
})

describe("setTraceHints", () => {
  const WITH_HINTS = `<board>
  <resistor name="R1" />
  <trace from=".R1 > .pin1" to="net.GND" thickness="0.4mm" schematicRouteHints={[{ x: 1, y: 0 }, { x: 1, y: 2 }]} />
  <trace from="R1.pin2" to="net.VCC" />
</board>
`
  const corners = [
    { x: 3.123456, y: 0 },
    { x: 3, y: -2 },
  ]
  const set = (source: string, from: string, to: string, hints = corners, locked: ReadonlySet<string> = none) =>
    applyEdits(source, [{ kind: "setTraceHints", from, to, schematicRouteHints: hints }], locked)

  test("replaces existing hints and keeps every other attribute byte for byte", () => {
    const out = set(WITH_HINTS, ".R1 > .pin1", "net.GND")
    expect(out).toBe(WITH_HINTS.replace("[{ x: 1, y: 0 }, { x: 1, y: 2 }]", "[{ x: 3.1235, y: 0 }, { x: 3, y: -2 }]"))
  })

  test("adds hints to a trace without any, matching the trace in either direction", () => {
    const out = set(WITH_HINTS, "net.VCC", "R1.pin2")
    expect(out).toBe(WITH_HINTS.replace('to="net.VCC" />', 'to="net.VCC" schematicRouteHints={[{ x: 3.1235, y: 0 }, { x: 3, y: -2 }]} />'))
  })

  test("an empty list removes the attribute", () => {
    const out = set(WITH_HINTS, ".R1 > .pin1", "net.GND", [])
    expect(out).toBe(WITH_HINTS.replace(" schematicRouteHints={[{ x: 1, y: 0 }, { x: 1, y: 2 }]}", ""))
    expect(set(WITH_HINTS, "R1.pin2", "net.VCC", [])).toBe(WITH_HINTS)
  })

  test("adds the attribute on its own line to a multi-line trace", () => {
    const source = '<board>\n  <trace\n    from="R1.pin2"\n    to="net.VCC"\n  />\n</board>\n'
    expect(set(source, "R1.pin2", "net.VCC")).toContain('    to="net.VCC"\n    schematicRouteHints={[')
  })

  test("refuses an unknown trace", () => {
    expectEditError(() => set(WITH_HINTS, "R1.pin1", "net.VCC"), "not_found")
  })

  test("refuses a trace inside .map() or one whose hints are not literals", () => {
    const inLoop = '<board>\n  {[1].map(() => <trace from=".A > .pin1" to="net.GND" />)}\n</board>'
    expectEditError(() => set(inLoop, ".A > .pin1", "net.GND"), "readonly")
    const computed = '<board>\n  <trace from="R1.pin2" to="net.VCC" schematicRouteHints={route} />\n</board>'
    expectEditError(() => set(computed, "R1.pin2", "net.VCC"), "readonly")
  })

  test("validates the corners as addTrace does", () => {
    expectEditError(() => set(WITH_HINTS, "R1.pin2", "net.VCC", [{ x: Number.NaN, y: 0 }]), "invalid")
    expectEditError(() => set(WITH_HINTS, "R1.pin2", "net.VCC", Array.from({ length: 201 }, () => ({ x: 0, y: 0 }))), "invalid")
  })

  test("refuses a trace that touches a locked part", () => {
    expectEditError(() => set(WITH_HINTS, "R1.pin2", "net.VCC", corners, new Set(["R1"])), "locked")
  })
})
