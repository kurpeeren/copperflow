import { describe, expect, test } from "vitest"
import type { LibraryPart } from "../studio/src/api.js"
import type { PartInfo } from "../src/core/types.js"
import { buildDesign } from "../src/engine/design.js"
import { FIND_IDLE, findNets, findNothing, findPick, findResults, findStatus, matchSummary, type FindNet } from "../studio/src/find.js"

const part = (name: string, props: Record<string, string | number> = {}): PartInfo => ({
  name,
  tag: "resistor",
  line: 1,
  start: 0,
  end: 0,
  editable: true,
  props: Object.fromEntries(Object.entries(props).map(([key, literal]) => [key, { literal, source: String(literal), editable: true }])),
})
const net = (id: string, names: string[]): FindNet => ({ id, label: names[0] ?? id, names })

const parts = [part("R10", { resistance: "10k", footprint: "0402" }), part("R2", { resistance: "1k", footprint: "0402" }), part("C1", { capacitance: "100nF", footprint: "0603" })]
const nets = [net("net.VCC", ["VCC"]), net("net.GND", ["GND"]), net("net:R1.pin1", [])]

describe("findResults", () => {
  test("an empty or blank query finds nothing", () => {
    expect(findResults("", parts, nets)).toEqual([])
    expect(findResults("   ", parts, nets)).toEqual([])
  })

  test("matches part names case-insensitively as substrings", () => {
    expect(findResults("r1", parts, []).map((row) => row.name)).toEqual(["R10"])
  })

  test("matches values and footprints, and says which", () => {
    const rows = findResults("0402", parts, nets)
    expect(rows.map((row) => row.name)).toEqual(["R2", "R10"])
    expect(rows[0]?.matches).toEqual([{ field: "footprint", text: "0402" }])
    expect(matchSummary(findResults("100NF", parts, nets)[0]!)).toBe("capacitance 100nF")
  })

  test("one part can match on several fields", () => {
    const row = findResults("0", [part("R0", { resistance: "10k", footprint: "0402" })], [])[0]!
    expect(matchSummary(row)).toBe("name, resistance 10k, footprint 0402")
  })

  test("matches net names, and an unnamed net never matches", () => {
    const rows = findResults("g", parts, nets)
    expect(rows).toEqual([{ id: "net:net.GND", kind: "net", name: "GND", net: "net.GND", matches: [{ field: "net name", text: "GND" }] }])
  })

  test("parts come first in natural order, then nets", () => {
    const rows = findResults("c", [part("C10"), part("C2")], [net("net.VCC", ["VCC"])])
    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual(["part:C2", "part:C10", "net:VCC"])
  })

  test("a prop written as an expression is not searched", () => {
    const expression: PartInfo = { ...part("R5"), props: { resistance: { literal: undefined, source: "{value}", editable: false } } }
    expect(findResults("value", [expression], [])).toEqual([])
  })

  test("any literal prop is searched, and the tag", () => {
    const led = part("D1", { color: "red", pcbX: 12, schRotation: 90 })
    const fuse = part("F1", { currentRating: "500mA" })
    expect(matchSummary(findResults("red", [led], [])[0]!)).toBe("color red")
    expect(matchSummary(findResults("500ma", [fuse], [])[0]!)).toBe("currentRating 500mA")
    expect(findResults("12", [led], [])).toEqual([])
    expect(findResults("90", [led], [])).toEqual([])
    expect(matchSummary(findResults("resistor", [part("R7")], [])[0]!)).toBe("kind resistor")
  })

  test("a library part's MPN and title are searched, once", () => {
    const entry: LibraryPart = { id: "p1", title: "Op amp", mpn: "LM358", footprint: "soic8", component: "lm358", verified: false }
    const u1: PartInfo = { ...part("U1", { mpn: "LM358" }), tag: "lm358" }
    expect(matchSummary(findResults("lm358", [u1], [], [entry])[0]!)).toBe("kind lm358, mpn LM358")
    expect(matchSummary(findResults("op amp", [{ ...u1, props: {} }], [], [entry])[0]!)).toBe("title Op amp")
  })

  test("nothing matching gives no rows, and the empty states have their words", () => {
    expect(findResults("zzz", parts, nets)).toEqual([])
    expect(findNothing("zzz")).toBe('Nothing matches "zzz".')
    expect(FIND_IDLE).toBe("Press Ctrl+F to find a part or a net.")
  })
})

const FILE = "main.circuit.tsx"
const design = buildDesign(
  {
    [FILE]: `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={3} pcbY={4} />
    <resistor name="R2" resistance="1k" footprint="0402" />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)`,
  },
  FILE,
)

describe("findNets and findPick", () => {
  test("the nets carry the Net tab's labels", () => {
    expect(findNets(design).some((n) => n.label === "GND" && n.names.includes("GND"))).toBe(true)
  })

  test("a part row selects the part and centres the open view on it", () => {
    const row = findResults("R1", [part("R1")], [])[0]!
    const pick = findPick(row, design, "pcb")
    expect(pick.select).toBe("R1")
    expect(pick.focus?.view).toBe("pcb")
    expect(Number.isFinite(pick.focus?.at.x)).toBe(true)
  })

  test("a part the open view does not place is selected without centring", () => {
    const pick = findPick({ id: "part:Z9", kind: "part", name: "Z9", matches: [] }, design, "schematic")
    expect(pick).toEqual({ select: "Z9" })
  })

  test("a net row highlights its net", () => {
    const row = findResults("gnd", [], findNets(design))[0]!
    expect(findPick(row, design, "pcb")).toEqual({ highlight: [row.net] })
  })
})

describe("findStatus", () => {
  test("says the count after a search, for the find box's live region, and nothing before one", () => {
    expect(findStatus(null, 0)).toBe("")
    expect(findStatus("r", 0)).toBe("No results")
    expect(findStatus("r", 1)).toBe("1 result")
    expect(findStatus("r", 3)).toBe("3 results")
  })
})
