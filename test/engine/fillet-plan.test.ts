import { describe, expect, test } from "vitest"
import { planFillet, planStraighten, type PlanDesign } from "../../src/engine/fillet-plan.js"
import type { Board, Keepout, Net, Point } from "../../src/engine/model.js"
import type { PcbTrack, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { loadRules } from "../../src/engine/rules/load.js"

const pt = (x: number, y: number): Point => ({ x, y })
const NETS: Net[] = [
  { id: "net.A", names: ["VBUS"], pins: [] },
  { id: "net.B", names: ["GND"], pins: [] },
]

function track(id: string, points: Point[], overrides: Partial<PcbTrack> = {}): PcbTrack {
  return { id, net: "net.A", layer: "top", width: 0.25, points, locked: false, by: "human", pads: [], ...overrides }
}
function via(id: string, at: Point, overrides: Partial<PcbVia> = {}): PcbVia {
  return { id, net: "net.A", at, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human", ...overrides }
}
function pad(id: string, at: Point, overrides: Partial<WorldPad> = {}): WorldPad {
  return { number: "1", shape: "rect", x: at.x, y: at.y, width: 1, height: 1, rotation: 0, layers: "top", id, component: id.split("#")[0] ?? id, ...overrides }
}
const outline = (x0: number, y0: number, x1: number, y1: number): Point[] => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]

interface Copper {
  tracks?: PcbTrack[]
  vias?: PcbVia[]
  pads?: WorldPad[]
  keepouts?: Keepout[]
  rulesYaml?: string
}

function designOf({ tracks = [], vias = [], pads = [], keepouts = [], rulesYaml }: Copper): PlanDesign {
  const part: PlacedFootprint = { component: "U1", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  const board: Board = { outline: outline(-30, -30, 30, 30), layers: 2, thickness: 1.6, keepouts }
  const rules = loadRules(rulesYaml === undefined ? {} : { "rules.yaml": rulesYaml }).rules
  return { circuit: { nets: NETS }, pcb: { board, parts: [part], tracks, vias, ratsnest: [] }, rules }
}

const L = track("t0001", [pt(0, 0), pt(10, 0), pt(10, 10)])
const STAIRS = track("t0002", [pt(-20, -20), pt(-10, -20), pt(-10, -10), pt(0, -10)])

describe("planFillet", () => {
  test("rounds every square corner of every track when none is named, and says how many", () => {
    const plan = planFillet(designOf({ tracks: [L, STAIRS] }))
    expect(plan.changes.map((c) => c.id)).toEqual(["t0001", "t0002"])
    expect(plan.summary).toBe("Rounded 3 corners on 2 tracks")
    expect(plan.changes[0]?.points.length).toBeGreaterThan(3)
  })

  test("takes the radius from the rules, or the one given", () => {
    const fromRules = planFillet(designOf({ tracks: [L], rulesYaml: "fabrication:\n  filletRadius: 2\n" }))
    expect(fromRules.changes[0]?.points[1]?.x).toBeCloseTo(8, 6)
    const given = planFillet(designOf({ tracks: [L] }), { radius: 3 })
    expect(given.changes[0]?.points[1]?.x).toBeCloseTo(7, 6)
    expect(planFillet(designOf({ tracks: [L] })).changes[0]?.points[1]?.x).toBeCloseTo(9, 6)
  })

  test("acts on the named tracks only, and ignores vias among them", () => {
    const plan = planFillet(designOf({ tracks: [L, STAIRS], vias: [via("v0001", pt(20, 20))] }), { ids: ["t0002", "v0001"] })
    expect(plan.changes.map((c) => c.id)).toEqual(["t0002"])
    expect(plan.summary).toBe("Rounded 2 corners on 1 track")
  })

  test("leaves a corner too close to another net's copper square and names the net", () => {
    const gnd = track("t0003", [pt(9.42, 0.58), pt(9.43, 0.57)], { net: "net.B" })
    const plan = planFillet(designOf({ tracks: [L, gnd] }), { ids: ["t0001"] })
    expect(plan.changes).toEqual([])
    expect(plan.summary).toBe("No corner was rounded; 1 left square: too close to GND")
  })

  test("names a pad on no net, the board edge and a keepout", () => {
    const loose = pad("U1#3", pt(9.424, 0.576), { width: 0.2, height: 0.2 })
    expect(planFillet(designOf({ tracks: [L], pads: [loose] })).summary).toBe("No corner was rounded; 1 left square: too close to U1#3")
    const edge = track("t0001", [pt(0, 29.75), pt(29.75, 29.75), pt(29.75, 0)])
    expect(planFillet(designOf({ tracks: [edge] }), { radius: 0.5 }).summary).toBe("No corner was rounded; 1 left square: too close to the board edge")
    const zone: Keepout = { id: "keepout1", outline: outline(9.5, 0.2, 9.7, 0.4), layers: "top", source: { file: "x.circuit.tsx", line: 1, column: 1, offset: 0 } }
    expect(planFillet(designOf({ tracks: [L], keepouts: [zone] })).summary).toBe("No corner was rounded; 1 left square: too close to keepout1")
  })

  test("copper of the track's own net nearby does not stop it", () => {
    const same = track("t0003", [pt(9.42, 0.58), pt(9.43, 0.57)])
    expect(planFillet(designOf({ tracks: [L, same] }), { ids: ["t0001"] }).summary).toBe("Rounded 1 corner on 1 track")
  })

  test("leaves a corner square where a via, a pad or another track's end joins it, when the arc would leave it", () => {
    const onVia = planFillet(designOf({ tracks: [L], vias: [via("v0001", pt(10, 0))] }), { radius: 3 })
    expect(onVia.summary).toBe("No corner was rounded; 1 left square: joined on the corner's legs")
    const branch = track("t0003", [pt(10, 0), pt(20, 0)])
    expect(planFillet(designOf({ tracks: [L, branch] }), { ids: ["t0001"] }).summary).toBe("No corner was rounded; 1 left square: joined on the corner's legs")
  })

  test("leaves a corner square where copper of its net joins a leg the arc would replace, away from the corner", () => {
    const square = "No corner was rounded; 1 left square: joined on the corner's legs"
    const branch = track("t0003", [pt(8.5, 0), pt(8.5, -5)])
    expect(planFillet(designOf({ tracks: [L, branch] }), { ids: ["t0001"], radius: 3 }).summary).toBe(square)
    expect(planFillet(designOf({ tracks: [L], vias: [via("v0001", pt(8.5, 0), { diameter: 0.4 })] }), { radius: 3 }).summary).toBe(square)
    expect(planFillet(designOf({ tracks: [L], pads: [pad("U1#2", pt(8.5, 0), { width: 0.3, height: 0.3, net: "net.A" })] }), { radius: 3 }).summary).toBe(square)
    // On the part of the leg that stays straight, it stays joined.
    const far = track("t0003", [pt(5, 0), pt(5, -5)])
    expect(planFillet(designOf({ tracks: [L, far] }), { ids: ["t0001"], radius: 3 }).summary).toBe("Rounded 1 corner on 1 track")
  })

  test("counts the reasons once each, and skips locked tracks and tracks on a locked part, saying so", () => {
    const short = track("t0003", [pt(-25, 20), pt(-15, 20), pt(-15, 20.4)])
    const locked = track("t0004", [pt(-25, 10), pt(-15, 10), pt(-15, 15)], { locked: true })
    const onPart = track("t0005", [pt(0, 25), pt(5, 25), pt(5, 28)])
    const part = pad("R1#1", pt(0, 25))
    const short2 = track("t0006", [pt(15, -25), pt(25, -25), pt(25, -24.6)])
    const plan = planFillet(designOf({ tracks: [L, short, locked, onPart, short2], pads: [part] }), { lockedParts: new Set(["R1"]) })
    expect(plan.changes.map((c) => c.id)).toEqual(["t0001"])
    expect(plan.summary).toBe("Rounded 1 corner on 1 track; 2 left square: too short; t0004 is locked; t0005 starts on the locked part R1")
  })

  test("a locked sub-sheet instance's parts lock the tracks that start on them; the others are rounded", () => {
    const onInstance = track("t0005", [pt(0, 25), pt(5, 25), pt(5, 28)])
    const design = designOf({ tracks: [L, onInstance], pads: [pad("R101#1", pt(0, 25))] })
    const plan = planFillet({ ...design, circuit: { ...design.circuit, instances: [{ path: "PS1", parts: ["R101"] }] } }, { lockedParts: new Set(["PS1"]) })
    expect(plan.changes.map((c) => c.id)).toEqual(["t0001"])
    expect(plan.summary).toBe("Rounded 1 corner on 1 track; t0005 starts on the locked part R101")
  })

  test("says so when there is nothing to round", () => {
    const straight = track("t0001", [pt(0, 0), pt(5, 0)])
    expect(planFillet(designOf({ tracks: [straight] }))).toEqual({ changes: [], summary: "No square corners to round" })
    expect(planFillet(designOf({}))).toEqual({ changes: [], summary: "No tracks to round" })
  })
})

describe("planStraighten", () => {
  test("puts the rounded corners back and says how many", () => {
    const rounded = planFillet(designOf({ tracks: [L, STAIRS] }))
    const back = planStraighten(designOf({ tracks: rounded.changes.map((c, i) => ({ ...[L, STAIRS][i] as PcbTrack, points: c.points })) }))
    expect(back.summary).toBe("Straightened 3 corners on 2 tracks")
    expect(back.changes[0]?.points).toEqual(L.points)
    expect(back.changes[1]?.points).toEqual(STAIRS.points)
  })

  const roundedL = () => ({ ...L, points: planFillet(designOf({ tracks: [L] })).changes[0]?.points ?? [] })
  const STAIRS_ROUND = () => ({ ...STAIRS, points: planFillet(designOf({ tracks: [STAIRS] })).changes[0]?.points ?? [] })

  test("keeps a corner round when the square corner would come too close to another net's copper", () => {
    const gnd = track("t0003", [pt(10.3, -0.3), pt(10.4, -0.4)], { net: "net.B" })
    const plan = planStraighten(designOf({ tracks: [roundedL(), STAIRS_ROUND(), gnd] }))
    expect(plan.changes.map((c) => c.id)).toEqual(["t0002"])
    expect(plan.summary).toBe("Straightened 2 corners on 1 track; 1 kept round: too close to GND")
  })

  test("keeps a corner round when copper of its net joins the arc and the square corner would leave it", () => {
    const onArc = via("v0001", pt(9.53, 0.47), { diameter: 0.4 })
    expect(planStraighten(designOf({ tracks: [roundedL()], vias: [onArc] })).summary).toBe("No corner was straightened; 1 kept round: joined on the arc")
  })

  test("says so when no corner is rounded, and skips locked tracks", () => {
    expect(planStraighten(designOf({ tracks: [L] }))).toEqual({ changes: [], summary: "No rounded corners to straighten" })
    const rounded = { ...L, points: planFillet(designOf({ tracks: [L] })).changes[0]?.points ?? [], locked: true }
    expect(planStraighten(designOf({ tracks: [rounded] })).summary).toBe("No rounded corners to straighten; t0001 is locked")
  })
})
