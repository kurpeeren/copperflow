import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { padChecks } from "../../src/engine/checks/drc-pads.js"
import { MIN_OUTLINE_POINTS, outlinePoints, usableOutline } from "../../src/engine/board.js"
import { breaksMinimum, LENGTH_TOLERANCE } from "../../src/engine/checks/limits.js"
import { violation, type Violation } from "../../src/engine/checks/violation.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { ENGINE_FILES } from "../../src/engine/engine.js"
import type { PadShape } from "../../src/engine/footprints/types.js"
import type { Board } from "../../src/engine/model.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"
import { netClasses } from "../../src/engine/rules/classes.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"

const MAIN = "main.circuit.tsx"
const PART = "parts/x/footprint.yaml"
const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))

/** A 20 x 20 mm board centred on the origin holding `body`, with optional extra project files. */
function design(body: string, files: Record<string, string> = {}): Design {
  const source = `export default () => (\n  <board width="20mm" height="20mm">\n${body}\n  </board>\n)\n`
  return buildDesign({ [MAIN]: source, ...files }, MAIN)
}

function check(built: Design): Violation[] {
  const { byNet } = netClasses(built.rules, built.circuit.nets)
  return padChecks(built.pcb, built.rules, (net) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name)))
}

const coded = (found: readonly Violation[], code: string) => found.filter((v) => v.code === code)

/** Two 0603 resistors side by side; 0603 pads are 0.9 mm wide at x = ±0.775, so the gap is x - 2.45. */
const pair = (x: number, traces = "") =>
  `<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />\n<resistor name="R2" resistance="1k" footprint="0603" pcbX={${x}} pcbY={0} />\n${traces}`
const NETS_A_B = `<trace from="R1.pin2" to="net.A" />\n<trace from="R2.pin1" to="net.B" />`

/** U1 with a footprint file holding these pads, written as YAML flow mappings. */
function withPads(pads: readonly string[], options: { rules?: string } = {}): Design {
  const pinCount = new Set(pads.map((p) => /number: '(\d+)'/.exec(p)?.[1])).size
  const yaml = ["pads:", ...pads.map((p) => `  - ${p}`), ""].join("\n")
  const files: Record<string, string> = { [PART]: yaml, ...(options.rules ? { "rules.yaml": options.rules } : {}) }
  return design(`<chip name="U1" footprint="${PART}" pinCount={${pinCount}} pcbX={0} pcbY={0} />`, files)
}

// ---- hand-made layouts, for cases a circuit file cannot express ----

function pad(id: string, overrides: Partial<WorldPad> = {}): WorldPad {
  return { number: "1", shape: "rect", x: 0, y: 0, width: 1, height: 1, rotation: 0, layers: "top", id, component: id.split("#")[0] ?? id, ...overrides }
}

function layoutOf(pads: WorldPad[], board?: Board): PcbLayout {
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { ...(board ? { board } : {}), parts: [part], ratsnest: [] }
}

const SQUARE: Board = {
  outline: [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ],
  layers: 2,
  thickness: 1.6,
  keepouts: [],
}
const RULES = loadRules({}).rules
const asDefault = () => DEFAULT_CLASS.name

describe("violation", () => {
  test("sorts the items naturally and builds the id from the code and the items", () => {
    const found = violation("clearance", "error", "m", ["R10#1", "R2#1"], "pcb")
    expect(found).toEqual({ id: "clearance:R2#1,R10#1", code: "clearance", severity: "error", message: "m", items: ["R2#1", "R10#1"], view: "pcb" })
    expect("at" in found).toBe(false)
  })

  test("keeps the point it is given", () => {
    expect(violation("board-edge", "error", "m", ["R1#1"], "pcb", { x: 1, y: 2 }).at).toEqual({ x: 1, y: 2 })
  })
})

describe("limits", () => {
  test("a value breaks a minimum only when it is smaller by more than the tolerance", () => {
    expect(LENGTH_TOLERANCE).toBe(1e-6)
    expect(breaksMinimum(0.2, 0.2)).toBe(false)
    expect(breaksMinimum(0.19999999999999996, 0.2)).toBe(false)
    expect(breaksMinimum(0.2 - LENGTH_TOLERANCE / 2, 0.2)).toBe(false)
    expect(breaksMinimum(0.199, 0.2)).toBe(true)
    expect(breaksMinimum(-1, 0.2)).toBe(true)
    expect(breaksMinimum(Infinity, 0.2)).toBe(false)
  })

  test("a value that is not a number breaks every minimum", () => {
    expect(breaksMinimum(Number.NaN, 0.2)).toBe(true)
  })

  test("an outline is usable when the board has one with at least 3 corners", () => {
    expect(usableOutline(undefined)).toBe(false)
    expect(usableOutline({ ...SQUARE, outline: [] })).toBe(false)
    expect(usableOutline({ ...SQUARE, outline: SQUARE.outline.slice(0, 2) })).toBe(false)
    expect(usableOutline({ ...SQUARE, outline: SQUARE.outline.slice(0, 3) })).toBe(true)
    expect(usableOutline(SQUARE)).toBe(true)
  })

  test("the board reader and the checks share one minimum number of outline corners", () => {
    const corners = SQUARE.outline.slice(0, MIN_OUTLINE_POINTS)
    expect(MIN_OUTLINE_POINTS).toBe(3)
    expect(outlinePoints(corners.slice(0, -1))).toBeUndefined()
    expect(outlinePoints(corners)).toEqual(corners)
    expect(usableOutline({ ...SQUARE, outline: corners.slice(0, -1) })).toBe(false)
    expect(usableOutline({ ...SQUARE, outline: corners })).toBe(true)
  })
})

describe("pad clearance", () => {
  test("two 0603 resistors 0.1 mm apart on different nets give one error on the two closest pads", () => {
    const found = coded(check(design(pair(2.55, NETS_A_B))), "clearance")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      id: "clearance:R1#2,R2#1",
      severity: "error",
      items: ["R1#2", "R2#1"],
      view: "pcb",
      message: "R1#2 and R2#1 are 0.100 mm apart; default needs 0.200 mm",
    })
    // The facing straight edges run from y = -0.25 to 0.25; the closest pair found first is at their lower end.
    expect(found[0]?.at?.x).toBeCloseTo(1.275, 9)
    expect(found[0]?.at?.y).toBeCloseTo(-0.25, 9)
  })

  test("pads exactly at the clearance pass, and 0.001 mm closer fail", () => {
    expect(coded(check(design(pair(2.65, NETS_A_B))), "clearance")).toEqual([])
    expect(coded(check(design(pair(2.649, NETS_A_B))), "clearance").map((v) => v.message)).toEqual([
      "R1#2 and R2#1 are 0.199 mm apart; default needs 0.200 mm",
    ])
  })

  test("the same pads on one net are fine", () => {
    const traces = `<trace from="R1.pin2" to="net.A" />\n<trace from="R2.pin1" to="net.A" />`
    expect(coded(check(design(pair(2.55, traces))), "clearance")).toEqual([])
  })

  test("a top pad over a bottom pad on another net is fine", () => {
    const body = `<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
<resistor name="R2" resistance="1k" footprint="0603" layer="bottom" pcbX={0} pcbY={0} />
${NETS_A_B}`
    expect(coded(check(design(body)), "clearance")).toEqual([])
  })

  test("a through pad near a bottom pad on another net is an error", () => {
    // J1#2 is a 1.7 mm round pad at x = 1.27; R1 is mirrored, so its pad 2 is the one at x = 3.445 - 0.775.
    const body = `<pinheader name="J1" pinCount={2} pitch="2.54mm" gender="male" pcbX={0} pcbY={0} />
<resistor name="R1" resistance="1k" footprint="0603" layer="bottom" pcbX={3.445} pcbY={0} />
<trace from="J1.pin2" to="net.A" />
<trace from="R1.pin2" to="net.B" />`
    const found = coded(check(design(body)), "clearance")
    expect(found.map((v) => v.message)).toEqual(["J1#2 and R1#2 are 0.100 mm apart; default needs 0.200 mm"])
  })

  test("a power class at 0.3 mm on GND sets the gap to another net", () => {
    const rules = "netClasses:\n  power:\n    clearance: 0.3\n    nets: [GND]\n"
    const traces = `<trace from="R1.pin2" to="net.GND" />\n<trace from="R2.pin1" to="net.SIG" />`
    const found = coded(check(design(pair(2.7, traces), { "rules.yaml": rules })), "clearance")
    expect(found.map((v) => v.message)).toEqual(["R1#2 and R2#1 are 0.250 mm apart; power–default needs 0.300 mm"])
  })

  test("a pad without a net near a power pad needs the power clearance", () => {
    const rules = "netClasses:\n  power:\n    clearance: 0.3\n    nets: [GND]\n"
    const found = coded(check(design(pair(2.7, `<trace from="R1.pin2" to="net.GND" />`), { "rules.yaml": rules })), "clearance")
    expect(found.map((v) => v.message)).toEqual(["R1#2 and R2#1 are 0.250 mm apart; power–default needs 0.300 mm"])
  })

  test("pads of one pin are one conductor, even without a net", () => {
    const overlapping = [0, 0.5].map((x) => `{ number: '1', shape: rect, x: ${x}, y: 0, width: 1, height: 1 }`)
    expect(check(withPads(overlapping))).toEqual([])
    const samePin = layoutOf([pad("U1#1", { pin: "U1.pin1" }), pad("U1#2", { number: "2", x: 0.5, pin: "U1.pin1" })])
    expect(padChecks(samePin, RULES, asDefault)).toEqual([])
    const otherParts = layoutOf([pad("U1#1"), pad("U2#1", { x: 0.5 })])
    expect(padChecks(otherParts, RULES, asDefault).map((v) => v.id)).toEqual(["clearance:U1#1,U2#1"])
  })

  test("pads without a net differ from each other", () => {
    expect(coded(check(design(pair(2.55))), "clearance").map((v) => v.id)).toEqual(["clearance:R1#2,R2#1"])
  })

  test("pads without a net use the default class, and one class is named once", () => {
    const rules = "netClasses:\n  power:\n    clearance: 0.3\n    nets: ['*']\n"
    expect(coded(check(design(pair(2.7), { "rules.yaml": rules })), "clearance")).toEqual([])
    const found = coded(check(design(pair(2.7, NETS_A_B), { "rules.yaml": rules })), "clearance")
    expect(found.map((v) => v.message)).toEqual(["R1#2 and R2#1 are 0.250 mm apart; power needs 0.300 mm"])
  })

  test("a pad without a net is default whatever classOf says", () => {
    const rules = loadRules({ "rules.yaml": "netClasses:\n  power:\n    clearance: 0.3\n    nets: [X]\n" }).rules
    const asPower = () => "power"
    const apart = (nets: Partial<WorldPad>[]) => layoutOf([pad("P1#1", nets[0]), pad("P2#1", { x: 1.25, ...nets[1] })])
    expect(padChecks(apart([{}, {}]), rules, asPower)).toEqual([])
    const found = padChecks(apart([{ net: "net.A" }, { net: "net.B" }]), rules, asPower)
    expect(found.map((v) => v.message)).toEqual(["P1#1 and P2#1 are 0.250 mm apart; power needs 0.300 mm"])
  })

  test("a class clearance wider than the pads still finds the neighbour", () => {
    const rules = "netClasses:\n  power:\n    nets: [GND]\nclassClearance:\n  - [power, default, 2.5]\n"
    const traces = `<trace from="R1.pin2" to="net.GND" />\n<trace from="R2.pin1" to="net.SIG" />`
    const found = check(design(pair(4.45, traces), { "rules.yaml": rules })).find((v) => v.id === "clearance:R1#2,R2#1")
    expect(found?.message).toBe("R1#2 and R2#1 are 2.000 mm apart; power–default needs 2.500 mm")
  })

  test("pads share copper on the same side or through the board, never top against bottom", () => {
    const cases: [WorldPad["layers"], WorldPad["layers"], number][] = [
      ["top", "top", 1],
      ["bottom", "bottom", 1],
      ["top", "bottom", 0],
      ["bottom", "top", 0],
      ["top", "through", 1],
      ["through", "bottom", 1],
      ["through", "through", 1],
    ]
    for (const [a, b, count] of cases) {
      const layout = layoutOf([pad("P1#1", { layers: a }), pad("P2#1", { x: 1.1, layers: b })])
      expect(coded(padChecks(layout, RULES, asDefault), "clearance"), `${a} against ${b}`).toHaveLength(count)
    }
  })

  test("overlapping pads on different nets are reported as touching", () => {
    const found = padChecks(layoutOf([pad("P1#1"), pad("P2#1", { x: 0.5 })]), RULES, asDefault)
    expect(found.map((v) => v.message)).toEqual(["P1#1 and P2#1 are touching or overlapping; default needs 0.200 mm"])
  })

  test("each pair is reported once", () => {
    const layout = layoutOf([pad("P1#1"), pad("P2#1", { x: 1.1 }), pad("P3#1", { x: 2.2 })])
    expect(padChecks(layout, RULES, asDefault).map((v) => v.id)).toEqual(["clearance:P1#1,P2#1", "clearance:P2#1,P3#1"])
  })

  test("pads whose ids differ only in leading zeros are still compared", () => {
    // R1 is turned half way, so its pad 2 faces R01's pad 2; the collator alone ranks "R01#2" and "R1#2" equal.
    const body = `<resistor name="R01" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />\n<resistor name="R1" resistance="1k" footprint="0603" pcbX={2.55} pcbY={0} pcbRotation={180} />`
    expect(coded(check(design(body)), "clearance").map((v) => v.items)).toEqual([["R01#2", "R1#2"]])
  })

  test("swapping two parts in the source keeps the violation ids", () => {
    const r01 = `<resistor name="R01" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />`
    const r1 = `<resistor name="R1" resistance="1k" footprint="0603" pcbX={2.55} pcbY={0} pcbRotation={180} />`
    const ids = (body: string) => check(design(body)).map((v) => v.id)
    expect(ids(`${r01}\n${r1}`)).toEqual(["clearance:R01#2,R1#2"])
    expect(ids(`${r1}\n${r01}`)).toEqual(["clearance:R01#2,R1#2"])
  })
})

describe("board edge", () => {
  test("a pad that crosses the board edge is an error", () => {
    const found = coded(check(design(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={9} pcbY={0} />`)), "board-edge")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: "board-edge:R1#2", severity: "error", message: "R1#2 crosses the board edge; the minimum gap to it is 0.200 mm" })
    expect(found[0]?.at?.x).toBeCloseTo(9.775, 9)
  })

  test("a pad closer to the edge than the limit is an error", () => {
    const found = coded(check(design(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={8.7} pcbY={0} />`)), "board-edge")
    expect(found.map((v) => v.message)).toEqual(["R1#2 is 0.075 mm from the board edge; the minimum is 0.200 mm"])
  })

  test("a pad whose centre is outside the board is an error", () => {
    const found = coded(check(design(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={10.5} pcbY={0} />`)), "board-edge")
    expect(found.map((v) => v.message)).toEqual([
      "R1#1 crosses the board edge; the minimum gap to it is 0.200 mm",
      "R1#2 is outside the board",
    ])
  })

  test("a hole that reaches past its pad counts", () => {
    const hole = pad("U1#1", { x: 9.5, width: 0.4, height: 0.4, layers: "through", drill: { width: 1, height: 1 } })
    expect(coded(padChecks(layoutOf([hole], SQUARE), RULES, asDefault), "board-edge").map((v) => v.message)).toEqual([
      "U1#1 crosses the board edge; the minimum gap to it is 0.200 mm",
    ])
  })

  test("is skipped without a board or without an outline", () => {
    const far = [pad("P1#1", { x: 50 })]
    expect(padChecks(layoutOf(far), RULES, asDefault)).toEqual([])
    expect(padChecks(layoutOf(far, { ...SQUARE, outline: [] }), RULES, asDefault)).toEqual([])
    expect(coded(padChecks(layoutOf(far, SQUARE), RULES, asDefault), "board-edge")).toHaveLength(1)
  })
})

describe("holes", () => {
  const MIN_DRILL_03 = "fabrication:\n  minDrill: 0.3\n"

  test("a footprint file with a 0.2 mm drill is an error", () => {
    const found = check(withPads(["{ number: '1', shape: circle, x: 0, y: 0, width: 0.8, height: 0.8, layers: through, drill: 0.2 }"], { rules: MIN_DRILL_03 }))
    expect(found).toEqual([violation("drill-size", "error", "U1#1 has a 0.200 mm drill; the minimum is 0.300 mm", ["U1#1"], "pcb", { x: 0, y: 0 })])
  })

  test("a slot is as small as its narrow side", () => {
    const slot = "{ number: '1', shape: oval, x: 0, y: 0, width: 1.6, height: 0.8, layers: through, drill: { width: 1, height: 0.2 } }"
    expect(coded(check(withPads([slot], { rules: MIN_DRILL_03 })), "drill-size").map((v) => v.message)).toEqual([
      "U1#1 has a 0.200 mm drill; the minimum is 0.300 mm",
    ])
  })

  test("a through pad with a 0.05 mm ring is an error", () => {
    const found = check(withPads(["{ number: '1', shape: circle, x: 0, y: 0, width: 0.7, height: 0.7, layers: through, drill: 0.6 }"]))
    expect(found).toEqual([violation("annular-ring", "error", "U1#1 has a 0.050 mm annular ring; the minimum is 0.180 mm", ["U1#1"], "pcb", { x: 0, y: 0 })])
  })

  test("a slot's ring is its thinnest copper, at the ends as well as the sides", () => {
    const slot = "{ number: '1', shape: oval, x: 0, y: 0, width: 1, height: 1.8, layers: through, drill: { width: 0.6, height: 1.7 } }"
    expect(coded(check(withPads([slot])), "annular-ring").map((v) => v.message)).toEqual(["U1#1 has a 0.050 mm annular ring; the minimum is 0.180 mm"])
  })

  test("a slot turned across its pad breaks out", () => {
    const slot = "{ number: '1', shape: oval, x: 0, y: 0, width: 1.8, height: 1, layers: through, drill: { width: 0.6, height: 1.4 } }"
    expect(coded(check(withPads([slot])), "annular-ring").map((v) => v.message)).toEqual([
      "The hole of U1#1 reaches the edge of its pad or beyond; the minimum annular ring is 0.180 mm",
    ])
  })

  test("two drills 0.3 mm apart are an error", () => {
    const pads = [-0.35, 0.35].map((x) => `{ number: '1', shape: circle, x: ${x}, y: 0, width: 1, height: 1, layers: through, drill: 0.4 }`)
    const found = check(withPads(pads))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      id: "hole-to-hole:U1#1,U1#1#2",
      severity: "error",
      message: "The holes of U1#1 and U1#1#2 are 0.300 mm apart; the minimum is 0.450 mm",
    })
    expect(found[0]?.at?.x).toBeCloseTo(0, 9)
  })

  test("drills on different nets are checked too", () => {
    const pads = ["1", "2"].map((n, i) => `{ number: '${n}', shape: circle, x: ${i * 0.7}, y: 0, width: 0.8, height: 0.8, layers: through, drill: 0.4 }`)
    expect(check(withPads(pads)).map((v) => [v.code, v.items])).toEqual([
      ["clearance", ["U1#1", "U1#2"]],
      ["hole-to-hole", ["U1#1", "U1#2"]],
    ])
  })

  test("a hole-to-hole limit wider than the clearance still finds the neighbour", () => {
    const pads = ["1", "2"].map((n, i) => `{ number: '${n}', shape: circle, x: ${i * 5 - 2.5}, y: 0, width: 2, height: 2, layers: through, drill: 1.6 }`)
    const found = check(withPads(pads, { rules: "fabrication:\n  minHoleToHole: 5\n" }))
    expect(found.map((v) => v.message)).toEqual(["The holes of U1#1 and U1#2 are 3.400 mm apart; the minimum is 5.000 mm"])
  })
})

describe("unchecked pads", () => {
  test("a pad shape the checks do not know is one warning per pad and is left out of clearance", () => {
    const odd = "hexagon" as PadShape
    const layout = layoutOf([pad("P1#1", { shape: odd }), pad("P2#1", { x: 1.1 }), pad("P3#1", { x: 2.2, shape: odd })])
    const found = padChecks(layout, RULES, asDefault)
    expect(found.map((v) => [v.code, v.severity, v.items])).toEqual([
      ["unchecked", "warning", ["P1#1"]],
      ["unchecked", "warning", ["P3#1"]],
    ])
    expect(found[0]?.message).toBe('P1#1 has the pad shape "hexagon", which the checks do not know; its copper is not checked')
  })
})

describe("results", () => {
  test("ids are stable across two builds, unique and in order", () => {
    const body = `${pair(2.55, NETS_A_B)}\n<resistor name="R3" resistance="1k" footprint="0603" pcbX={9} pcbY={0} />`
    const first = check(design(body)).map((v) => v.id)
    const second = check(design(body)).map((v) => v.id)
    expect(first.length).toBeGreaterThan(1)
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
    expect([...first].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))).toEqual(first)
  })

  test("the USB-C example passes every pad check, with no clearance among J1's shell pads on GND", async () => {
    const built = buildDesign(await collectProjectFiles(EXAMPLE, { include: ENGINE_FILES }), "index.circuit.tsx")
    const shells = new Set(built.pcb.parts.find((p) => p.component === "J1")?.pads.filter((p) => p.layers === "through").map((p) => p.id))
    expect(shells.size).toBe(4)
    const found = check(built)
    expect(found.filter((v) => v.code === "clearance" && v.items.some((item) => shells.has(item)))).toEqual([])
    expect(found).toEqual([])
  })
})
