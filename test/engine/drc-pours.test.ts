import { describe, expect, test } from "vitest"
import { pourChecks } from "../../src/engine/checks/drc-pours.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import type { Board, Hole, Keepout, Point } from "../../src/engine/model.js"
import type { PcbLayout, PcbTrack, PlacedFootprint, PourFill, WorldPad } from "../../src/engine/pcb.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"

const RULES = loadRules({}).rules
const asDefault = () => DEFAULT_CLASS.name
const SOURCE = { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 }
const EDGE = RULES.fabrication.boardEdgeClearance
const mm = (value: number) => value.toFixed(3)

const square = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
/** The same square drawn clockwise, as a hole is. */
const clockwise = (x0: number, y0: number, x1: number, y1: number): Point[] => [...square(x0, y0, x1, y1)].reverse()

const BOARD: Board = { outline: square(-10, -10, 10, 10), layers: 2, thickness: 1.6, keepouts: [] }

function fill(id: string, net: string, outer: Point[], holes: Point[][] = [], layer: PourFill["layer"] = "top"): PourFill {
  return { id, net, layer, polygons: [{ outer, holes }], area: 0 }
}

function pad(id: string, net: string | undefined, x: number, y: number, layers: WorldPad["layers"] = "top"): WorldPad {
  return { number: "1", shape: "rect", x, y, width: 1, height: 1, rotation: 0, layers, id, component: id.split("#")[0] ?? id, ...(net === undefined ? {} : { net }) }
}

function track(id: string, net: string, points: Point[]): PcbTrack {
  return { id, net, layer: "top", width: 0.25, points, locked: false, by: "human", pads: [] }
}

const hole = (id: string, x: number, y: number, diameter: number): Hole => ({ id, x, y, diameter, source: SOURCE })

interface Scene {
  pours?: PourFill[]
  pads?: WorldPad[]
  tracks?: PcbTrack[]
  holes?: Hole[]
  keepouts?: Keepout[]
}

function layoutOf({ pours = [], pads = [], tracks = [], holes = [], keepouts = [] }: Scene): PcbLayout {
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { board: { ...BOARD, keepouts }, parts: [part], ratsnest: [], tracks, vias: [], pours, holes }
}

const run = (scene: Scene) => pourChecks(layoutOf(scene), RULES, asDefault)
const GND_PAD = pad("X#9", "net.GND", -5, -5)

describe("the pour in the clearance checks", () => {
  test("a pour of GND over a track of another net is a clearance violation; one 0.25 mm clear is not", () => {
    const pour = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8), [clockwise(-1, -1, 1, 1)])
    const inside = track("t0001", "net.A", [{ x: 2, y: 2 }, { x: 4, y: 2 }])
    const found = run({ pours: [pour], pads: [GND_PAD], tracks: [inside] })
    expect(found.map((v) => [v.id, v.severity])).toEqual([["copper-clearance:copperpour:1|t0001", "error"]])
    expect(found[0]?.message).toBe("copperpour:1 and t0001 are touching or overlapping; default needs 0.200 mm")
    const clear = track("t0001", "net.A", [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }])
    expect(run({ pours: [pour], pads: [GND_PAD], tracks: [clear] })).toEqual([])
    const near = track("t0001", "net.A", [{ x: 0, y: 0 }, { x: 0, y: 0.8 }])
    expect(run({ pours: [pour], pads: [GND_PAD], tracks: [near] }).map((v) => v.message)).toEqual(["copperpour:1 and t0001 are 0.075 mm apart; default needs 0.200 mm"])
  })

  test("its own net's copper and copper on the other layer are not measured", () => {
    const pour = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8))
    const own = track("t0001", "net.GND", [{ x: 2, y: 2 }, { x: 4, y: 2 }])
    const bottom: PcbTrack = { ...track("t0002", "net.A", [{ x: 2, y: 3 }, { x: 4, y: 3 }]), layer: "bottom" }
    expect(run({ pours: [pour], pads: [GND_PAD], tracks: [own, bottom] })).toEqual([])
  })

  test("two pours of different nets too close on one layer, and a pad of no net inside a pour", () => {
    const a = fill("copperpour:1", "net.GND", square(-8, -8, 0, 8))
    const b = fill("copperpour:2", "net.VCC", square(0.1, -8, 8, 8))
    const found = run({ pours: [a, b], pads: [GND_PAD, pad("X#2", "net.VCC", 5, 5), pad("X#3", undefined, -3, 3)] })
    expect(found.map((v) => v.id)).toEqual(["copper-clearance:copperpour:1|copperpour:2", "copper-clearance:copperpour:1|X#3"])
  })
})

describe("holes", () => {
  test("copper nearer a hole than the board-edge clearance is a copper-hole violation", () => {
    const near = track("t0001", "net.A", [{ x: 0, y: 1.725 + EDGE / 2 }, { x: 3, y: 1.725 + EDGE / 2 }])
    const far = track("t0002", "net.A", [{ x: 0, y: -1.6 - EDGE - 0.125 }, { x: 3, y: -1.6 - EDGE - 0.125 }])
    const found = run({ holes: [hole("hole:1", 0, 0, 3.2)], tracks: [near, far], pads: [pad("X#1", "net.A", 1.6, 0)] })
    expect(found.map((v) => v.id)).toEqual(["copper-hole:hole:1|t0001", "copper-hole:hole:1|X#1"])
    expect(found[0]?.message).toBe(`t0001 is ${mm(EDGE / 2)} mm from hole:1; copper keeps ${mm(EDGE)} mm from a hole`)
  })

  test("a pour too near a hole, or over it, is one too", () => {
    const ring = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8), [clockwise(-1.7, -1.7, 1.7, 1.7)])
    expect(run({ holes: [hole("hole:1", 0, 0, 3.2)], pours: [ring], pads: [GND_PAD] }).map((v) => v.id)).toEqual(["copper-hole:copperpour:1|hole:1"])
    const solid = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8))
    expect(run({ holes: [hole("hole:1", 0, 0, 1)], pours: [solid], pads: [GND_PAD] }).map((v) => v.message)).toEqual([
      `copperpour:1 touches or overlaps hole:1; copper keeps ${mm(EDGE)} mm from a hole`,
    ])
  })
})

describe("a pour that joins no pad of its net", () => {
  test("is a pour-floating warning naming it", () => {
    const pour = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8), [], "bottom")
    const found = run({ pours: [pour], pads: [GND_PAD] })
    expect(found.map((v) => [v.id, v.severity, v.items])).toEqual([["pour-floating:copperpour:1", "warning", ["copperpour:1"]]])
    expect(found[0]?.message).toBe("copperpour:1 joins no pad of net.GND")
    expect(run({ pours: [pour], pads: [pad("X#9", "net.GND", -5, -5, "through")] })).toEqual([])
  })
})

describe("a pour that joins few of its net's pads", () => {
  const PADS = [pad("X#1", "net.GND", -5, -5, "through"), pad("X#2", "net.GND", 5, 5), pad("X#3", "net.GND", -5, 5), pad("X#4", "net.GND", 5, -5)]
  const bottom = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8), [], "bottom")

  test("joining fewer than half is a pour-sparse warning with the count; half or more is not", () => {
    const found = run({ pours: [bottom], pads: PADS })
    expect(found.map((v) => [v.id, v.severity])).toEqual([["pour-sparse:copperpour:1", "warning"]])
    expect(found[0]?.message).toMatch(/^copperpour:1 joins only 1 of 4 net\.GND pads/)
    expect(run({ pours: [bottom], pads: PADS.map((one) => ({ ...one, layers: one.id === "X#2" ? "through" : one.layers })) })).toEqual([])
  })

  test("a pour on the other side joining the rest leaves the pair without a warning", () => {
    const top = fill("copperpour:2", "net.GND", square(-8, -8, 8, 8))
    expect(run({ pours: [bottom, top], pads: PADS })).toEqual([])
  })
})

describe("on a built board", () => {
  const MAIN = "main.circuit.tsx"
  const LAYOUT = "main.circuit.layout.json"
  const circuit = `export default () => (<board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from="R1.pin1" to="net.GND" />
    <trace from="R2.pin1" to="net.GND" />
    <trace from="R1.pin2" to="net.SIG" />
    <trace from="R2.pin2" to="net.SIG" />
    <copperpour net="GND" layer="top" />
    <hole x={-8} y={4} diameter={1.5} />
  </board>)`
  const withTrack = (record: Record<string, unknown>) => buildDesign({ [MAIN]: circuit, [LAYOUT]: `${JSON.stringify(record)}\n` }, MAIN)
  const copperFindings = (design: Design) => design.violations.filter((v) => v.code.startsWith("copper") || v.code.startsWith("pour"))

  test("a track of another net through the pour makes the fill retreat, with no violation", () => {
    const before = buildDesign({ [MAIN]: circuit }, MAIN)
    const after = withTrack({ t: "track", id: "t0001", net: "SIG", layer: "top", width: 0.25, points: [{ x: -6, y: 4 }, { x: 6, y: 4 }], locked: false, by: "human" })
    expect(after.pcb.pours[0]?.area).toBeLessThan((before.pcb.pours[0]?.area ?? 0) - 12 * 0.65)
    expect(copperFindings(before)).toEqual([])
    expect(copperFindings(after)).toEqual([])
  })

  test("a track run near the hole is a copper-hole violation", () => {
    const design = withTrack({ t: "track", id: "t0001", net: "SIG", layer: "bottom", width: 0.25, points: [{ x: -8, y: 3 }, { x: -6, y: 3 }], locked: false, by: "human" })
    expect(design.violations.filter((v) => v.code === "copper-hole").map((v) => v.id)).toEqual(["copper-hole:hole:1|t0001"])
  })
})

describe("the fill against the board edge and keepouts, a safety net with a 2 µm tolerance", () => {
  const inner = 10 - EDGE

  test("a fill nearer the board edge than its clearance is copper-edge; one at it, or a micrometre over, is not", () => {
    const near = run({ pours: [fill("copperpour:1", "net.GND", square(-9.95, -inner, inner, inner))], pads: [GND_PAD] })
    expect(near.map((v) => [v.id, v.message])).toEqual([["copper-edge:copperpour:1", `copperpour:1 comes nearer the board edge than ${mm(EDGE)} mm`]])
    expect(run({ pours: [fill("copperpour:1", "net.GND", square(-inner, -inner, inner, inner))], pads: [GND_PAD] })).toEqual([])
    expect(run({ pours: [fill("copperpour:1", "net.GND", square(-inner - 0.001, -inner, inner, inner))], pads: [GND_PAD] })).toEqual([])
  })

  test("a fill reaching into a keepout on its layer is copper-keepout; one around it, or a keepout on the other layer, is not", () => {
    const keepout = (layers: Keepout["layers"]): Keepout => ({ id: "keepout:1", outline: square(4, 4, 6, 6), layers, source: SOURCE })
    const whole = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8))
    expect(run({ pours: [whole], pads: [GND_PAD], keepouts: [keepout("all")] }).map((v) => [v.id, v.message])).toEqual([
      ["copper-keepout:copperpour:1|keepout:1", "copperpour:1 lies inside keepout:1"],
    ])
    expect(run({ pours: [whole], pads: [GND_PAD], keepouts: [keepout("bottom")] })).toEqual([])
    const around = fill("copperpour:1", "net.GND", square(-8, -8, 8, 8), [clockwise(4, 4, 6, 6)])
    expect(run({ pours: [around], pads: [GND_PAD], keepouts: [keepout("top")] })).toEqual([])
  })
})
