import { describe, expect, test } from "vitest"
import type { CopperLayer } from "../../src/core/layout-file.js"
import { copperChecks } from "../../src/engine/checks/drc-copper.js"
import type { Violation } from "../../src/engine/checks/violation.js"
import type { Board, Keepout, Point } from "../../src/engine/model.js"
import type { PcbLayout, PcbTrack, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"
import type { Rules } from "../../src/engine/rules/schema.js"

const RULES = loadRules({}).rules
const asDefault = () => DEFAULT_CLASS.name

function pad(id: string, overrides: Partial<WorldPad> = {}): WorldPad {
  return { number: "1", shape: "rect", x: 0, y: 0, width: 1, height: 1, rotation: 0, layers: "top", id, component: id.split("#")[0] ?? id, ...overrides }
}

function track(id: string, points: Point[], overrides: Partial<PcbTrack> = {}): PcbTrack {
  return { id, net: "net.A", layer: "top", width: 0.25, points, locked: false, by: "human", pads: [], ...overrides }
}

function via(id: string, at: Point, overrides: Partial<PcbVia> = {}): PcbVia {
  return { id, net: "net.A", at, drill: 0.3, diameter: 0.8, layers: ["top", "bottom"], locked: false, by: "human", ...overrides }
}

interface Copper {
  pads?: WorldPad[]
  tracks?: PcbTrack[]
  vias?: PcbVia[]
  board?: Board
}

function layoutOf({ pads = [], tracks = [], vias = [], board }: Copper): PcbLayout {
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { ...(board ? { board } : {}), parts: [part], ratsnest: [], tracks, vias }
}

const square = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function boardWith(keepouts: Keepout[] = []): Board {
  return { outline: square(-10, -10, 10, 10), layers: 2, thickness: 1.6, keepouts }
}

const keepout = (id: string, layers: Keepout["layers"]): Keepout => ({ id, outline: square(4, 4, 6, 6), layers, source: { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 } })

const run = (copper: Copper, rules: Rules = RULES, classOf: (net: string | undefined) => string = asDefault): Violation[] =>
  copperChecks(layoutOf({ board: boardWith(), ...copper }), rules, classOf)
const coded = (found: readonly Violation[], code: string) => found.filter((v) => v.code === code)
const ids = (found: readonly Violation[], code: string) => coded(found, code).map((v) => v.id)
const across = (y: number, overrides: Partial<PcbTrack> = {}, id = "t0002") => track(id, [{ x: -2, y }, { x: 2, y }], { net: "net.B", ...overrides })
const BASE = track("t0001", [{ x: -2, y: 0 }, { x: 2, y: 0 }])

describe("clearance between tracks", () => {
  test("two tracks of different nets 0.15 mm apart break the default 0.2 mm", () => {
    const found = run({ tracks: [BASE, across(0.4)] })
    expect(coded(found, "copper-clearance")).toEqual([
      {
        id: "copper-clearance:t0001|t0002",
        code: "copper-clearance",
        severity: "error",
        message: "t0001 and t0002 are 0.150 mm apart; default needs 0.200 mm",
        items: ["t0001", "t0002"],
        view: "pcb",
        at: { x: -2, y: 0.2 },
      },
    ])
  })

  test("0.25 mm apart passes, and so does the same net or another layer", () => {
    expect(ids(run({ tracks: [BASE, across(0.5)] }), "copper-clearance")).toEqual([])
    expect(ids(run({ tracks: [BASE, across(0.4, { net: "net.A" })] }), "copper-clearance")).toEqual([])
    expect(ids(run({ tracks: [BASE, across(0.4, { layer: "bottom" })] }), "copper-clearance")).toEqual([])
  })

  test("crossing tracks of two nets are touching", () => {
    const crossing = track("t0002", [{ x: 0, y: -2 }, { x: 0, y: 2 }], { net: "net.B" })
    expect(coded(run({ tracks: [BASE, crossing] }), "copper-clearance")[0]?.message).toBe("t0001 and t0002 are touching or overlapping; default needs 0.200 mm")
  })

  test("a bend is measured segment by segment, and the pair is reported once", () => {
    const bent = track("t0002", [{ x: -2, y: 0.4 }, { x: 0, y: 0.4 }, { x: 0, y: 3 }], { net: "net.B" })
    expect(ids(run({ tracks: [BASE, bent] }), "copper-clearance")).toEqual(["copper-clearance:t0001|t0002"])
  })
})

describe("clearance to pads", () => {
  const padB = pad("P#1", { net: "net.B" })

  test("a track 0.175 mm from a pad of another net breaks the clearance", () => {
    const found = run({ pads: [padB], tracks: [track("t0001", [{ x: -2, y: 0.8 }, { x: 2, y: 0.8 }])] })
    expect(coded(found, "copper-clearance").map((v) => [v.id, v.items, v.message])).toEqual([
      ["copper-clearance:P#1|t0001", ["P#1", "t0001"], "P#1 and t0001 are 0.175 mm apart; default needs 0.200 mm"],
    ])
  })

  test("the pad's rotation turns its outline: an oval stood on end reaches the track", () => {
    const oval = pad("P#1", { net: "net.B", shape: "oval", width: 2, height: 0.5 })
    const near = [track("t0001", [{ x: -2, y: 1.3 }, { x: 2, y: 1.3 }])]
    expect(ids(run({ pads: [oval], tracks: near }), "copper-clearance")).toEqual([])
    expect(ids(run({ pads: [{ ...oval, rotation: 90 }], tracks: near }), "copper-clearance")).toEqual(["copper-clearance:P#1|t0001"])
  })

  test("a circle pad is measured as a circle", () => {
    const round = pad("P#1", { net: "net.B", shape: "circle", width: 1, height: 1 })
    const diagonal = 0.5 + 0.125 + 0.15
    const at = diagonal / Math.SQRT2
    const corner = [track("t0001", [{ x: at, y: at }, { x: at + 2, y: at + 2 }])]
    expect(ids(run({ pads: [round], tracks: corner }), "copper-clearance")).toEqual(["copper-clearance:P#1|t0001"])
    expect(ids(run({ pads: [{ ...round, shape: "rect" }], tracks: corner }), "copper-clearance")).toEqual(["copper-clearance:P#1|t0001"])
  })

  test("a track on the bottom passes a top pad; a through pad is on every layer", () => {
    const bottom = [track("t0001", [{ x: -2, y: 0.8 }, { x: 2, y: 0.8 }], { layer: "bottom" })]
    expect(ids(run({ pads: [padB], tracks: bottom }), "copper-clearance")).toEqual([])
    expect(ids(run({ pads: [{ ...padB, layers: "through" }], tracks: bottom }), "copper-clearance")).toEqual(["copper-clearance:P#1|t0001"])
  })

  test("a via 0.15 mm from a pad of another net breaks the clearance", () => {
    const found = run({ pads: [padB], vias: [via("v0001", { x: 1.05, y: 0 })] })
    expect(coded(found, "copper-clearance").map((v) => v.message)).toEqual(["P#1 and v0001 are 0.150 mm apart; default needs 0.200 mm"])
  })

  test("copper on the pad's own net touches it freely, and two pads are left to the pad checks", () => {
    const own = [track("t0001", [{ x: 0, y: 0 }, { x: 3, y: 0 }], { net: "net.B" })]
    expect(ids(run({ pads: [padB], tracks: own }), "copper-clearance")).toEqual([])
    expect(ids(run({ pads: [padB, pad("Q#1", { x: 1.1, net: "net.C" })] }), "copper-clearance")).toEqual([])
  })

  test("copper joined to a pad (the pad is among its pads) is one conductor with it, net or no net; copper.ts reports any short", () => {
    const shorted = [track("t0001", [{ x: 0, y: 0 }, { x: 3, y: 0 }], { net: undefined, pads: ["P#1"] })]
    expect(ids(run({ pads: [padB], tracks: shorted }), "copper-clearance")).toEqual([])
  })

  test("copper over a pad it is not joined to is a clearance error, whatever its net", () => {
    const over = (net: string | undefined) => [track("t0001", [{ x: -2, y: 0.3 }, { x: 2, y: 0.3 }], { net })]
    expect(coded(run({ pads: [padB], tracks: over("net.A") }), "copper-clearance").map((v) => v.message)).toEqual([
      "P#1 and t0001 are touching or overlapping; default needs 0.200 mm",
    ])
    expect(ids(run({ pads: [padB], tracks: over(undefined) }), "copper-clearance")).toEqual(["copper-clearance:P#1|t0001"])
  })

  test("a pad with no net is never one conductor with copper: a track ending on it is a clearance error", () => {
    const loose = pad("U#5")
    const onto = [track("t0001", [{ x: 0, y: 0 }, { x: 3, y: 0 }], { pads: ["U#5"] })]
    expect(ids(run({ pads: [loose], tracks: onto }), "copper-clearance")).toEqual(["copper-clearance:t0001|U#5"])
  })

  test("a via joins a pad when its centre is on the pad, else it clashes", () => {
    expect(ids(run({ pads: [padB], vias: [via("v0001", { x: 0.4, y: 0 }, { net: undefined })] }), "copper-clearance")).toEqual([])
    expect(ids(run({ pads: [padB], vias: [via("v0001", { x: 0.6, y: 0 }, { net: undefined })] }), "copper-clearance")).toEqual(["copper-clearance:P#1|v0001"])
  })
})

describe("copper on no net", () => {
  test("a floating track passing a hair from tracks of two nets is a clearance error with each (crossing joins them: a short)", () => {
    const a = track("t0001", [{ x: 0, y: -2 }, { x: 0, y: 2 }])
    const b = track("t0002", [{ x: 5, y: -2 }, { x: 5, y: 2 }], { net: "net.B" })
    const bridge = track("t0003", [{ x: -1, y: 0 }, { x: 6, y: 0 }], { net: undefined })
    expect(ids(run({ tracks: [a, b, { ...bridge, width: 0.01, points: [{ x: -1, y: 3 }, { x: 6, y: 3 }] }] }), "copper-clearance")).toEqual([])
    expect(ids(run({ tracks: [a, b, { ...bridge, points: [{ x: -1, y: 2.3 }, { x: 6, y: 2.3 }] }] }), "copper-clearance")).toEqual([
      "copper-clearance:t0001|t0003",
      "copper-clearance:t0002|t0003",
    ])
  })
})

describe("clearance of vias", () => {
  test("a via 0.175 mm from a track of another net", () => {
    expect(ids(run({ tracks: [BASE], vias: [via("v0001", { x: 0, y: 0.7 }, { net: "net.B" })] }), "copper-clearance")).toEqual(["copper-clearance:t0001|v0001"])
  })

  test("two vias 0.15 mm apart are reported once though they share two layers", () => {
    const found = run({ vias: [via("v0001", { x: 0, y: 0 }), via("v0002", { x: 0.95, y: 0 }, { net: "net.B" })] })
    expect(coded(found, "copper-clearance").map((v) => [v.id, v.at])).toEqual([["copper-clearance:v0001|v0002", { x: 0.475, y: 0 }]])
  })

  test("a top-to-bottom via spans the inner layers", () => {
    const inner = [track("t0001", [{ x: -2, y: 0 }, { x: 2, y: 0 }], { layer: "inner1" as CopperLayer })]
    expect(ids(run({ tracks: inner, vias: [via("v0001", { x: 0, y: 0.7 }, { net: "net.B" })] }), "copper-clearance")).toEqual(["copper-clearance:t0001|v0001"])
    const blind = via("v0001", { x: 0, y: 0.7 }, { net: "net.B", layers: ["bottom", "inner2"] })
    expect(ids(run({ tracks: inner, vias: [blind] }), "copper-clearance")).toEqual([])
  })
})

describe("exact limits", () => {
  test("a gap of exactly the clearance passes, a hair less fails", () => {
    expect(ids(run({ tracks: [BASE, across(0.45)] }), "copper-clearance")).toEqual([])
    expect(ids(run({ tracks: [BASE, across(0.449)] }), "copper-clearance")).toEqual(["copper-clearance:t0001|t0002"])
  })

  test("a track exactly the class width and a via ring exactly the minimum pass", () => {
    expect(ids(run({ tracks: [{ ...BASE, width: 0.25 }] }), "track-width")).toEqual([])
    expect(ids(run({ tracks: [{ ...BASE, width: 0.249 }] }), "track-width")).toEqual(["track-width:t0001"])
    expect(ids(run({ vias: [via("v0001", { x: 0, y: 0 }, { drill: 0.3, diameter: 0.66 })] }), "via-ring")).toEqual([])
    expect(ids(run({ vias: [via("v0001", { x: 0, y: 0 }, { drill: 0.3, diameter: 0.659 })] }), "via-ring")).toEqual(["via-ring:v0001"])
  })

  test("a pair straddling grid cells at negative coordinates is found", () => {
    const left = track("t0001", [{ x: -4.1, y: -2.05 }, { x: -4.1, y: -6 }])
    const right = track("t0002", [{ x: -3.75, y: -1.95 }, { x: -3.75, y: 1 }], { net: "net.B" })
    expect(ids(run({ tracks: [left, right] }), "copper-clearance")).toEqual(["copper-clearance:t0001|t0002"])
  })
})

describe("class clearances", () => {
  const rules = loadRules({ "rules.yaml": "netClasses:\n  power:\n    nets: [A]\nclassClearance:\n  - [power, default, 0.5]\n" }).rules
  const classOf = (net: string | undefined) => (net === "net.A" ? "power" : "default")

  test("the class-to-class entry sets the gap between the two classes", () => {
    const found = run({ tracks: [BASE, across(0.55)] }, rules, classOf)
    expect(coded(found, "copper-clearance").map((v) => v.message)).toEqual(["t0001 and t0002 are 0.300 mm apart; power–default needs 0.500 mm"])
  })

  test("the pair is named in the order the rule writes it, whichever piece comes first", () => {
    const flipped = run({ tracks: [{ ...BASE, net: "net.B" }, across(0.55, { net: "net.A" })] }, rules, classOf)
    expect(coded(flipped, "copper-clearance").map((v) => v.message)).toEqual(["t0001 and t0002 are 0.300 mm apart; power–default needs 0.500 mm"])
  })

  test("when the fabrication minimum is the largest, the message names it", () => {
    const strict = loadRules({ "rules.yaml": ["fabrication:", "  minClearance: 0.3", ""].join("\n") }).rules
    const found = run({ tracks: [BASE, across(0.5)] }, strict)
    expect(coded(found, "copper-clearance").map((v) => v.message)).toEqual(["t0001 and t0002 are 0.250 mm apart; the fabrication minimum is 0.300 mm"])
  })

  test("two default nets keep the default gap", () => {
    const found = run({ tracks: [BASE, across(0.55)] }, rules, asDefault)
    expect(ids(found, "copper-clearance")).toEqual([])
  })

  test("a class clearance larger than the cell still finds the pair", () => {
    const wide = loadRules({ "rules.yaml": "netClasses:\n  hv:\n    clearance: 5\n    nets: [A]\n" }).rules
    const found = run({ tracks: [BASE, across(4.5)] }, wide, (net) => (net === "net.A" ? "hv" : "default"))
    expect(ids(found, "copper-clearance")).toEqual(["copper-clearance:t0001|t0002"])
  })
})

describe("track width", () => {
  test("a track narrower than its class width is an error at its first point", () => {
    const found = run({ tracks: [track("t0001", [{ x: 1, y: 2 }, { x: 3, y: 2 }], { width: 0.15 })] })
    expect(coded(found, "track-width")).toEqual([
      {
        id: "track-width:t0001",
        code: "track-width",
        severity: "error",
        message: "t0001 is 0.150 mm wide; default needs 0.250 mm",
        items: ["t0001"],
        view: "pcb",
        at: { x: 1, y: 2 },
      },
    ])
  })

  test("the class width passes; the fabrication minimum wins when it is larger", () => {
    expect(ids(run({ tracks: [BASE] }), "track-width")).toEqual([])
    const fine = loadRules({ "rules.yaml": "fabrication:\n  minTrackWidth: 0.3\n" }).rules
    expect(coded(run({ tracks: [BASE] }, fine), "track-width").map((v) => v.message)).toEqual(["t0001 is 0.250 mm wide; the fabrication minimum is 0.300 mm"])
  })
})

describe("vias", () => {
  test("a drill under the minimum", () => {
    const found = run({ vias: [via("v0001", { x: 0, y: 0 }, { drill: 0.1, diameter: 0.6 })] })
    expect(coded(found, "via-drill").map((v) => [v.id, v.message, v.at])).toEqual([["via-drill:v0001", "v0001 has a 0.100 mm drill; the minimum is 0.150 mm", { x: 0, y: 0 }]])
  })

  test("an annular ring under the minimum", () => {
    const found = run({ vias: [via("v0001", { x: 0, y: 0 }, { drill: 0.3, diameter: 0.5 })] })
    expect(coded(found, "via-ring").map((v) => [v.id, v.message])).toEqual([["via-ring:v0001", "v0001 has a 0.100 mm annular ring; the minimum is 0.180 mm"]])
    expect(ids(run({ vias: [via("v0001", { x: 0, y: 0 })] }), "via-ring")).toEqual([])
  })
})

describe("the board edge", () => {
  test("a track 0.075 mm from the edge breaks the 0.2 mm edge clearance", () => {
    const found = run({ tracks: [track("t0001", [{ x: -2, y: 9.8 }, { x: 2, y: 9.8 }])] })
    expect(coded(found, "copper-edge").map((v) => [v.id, v.message])).toEqual([
      ["copper-edge:t0001", "t0001 is 0.075 mm from the board edge; the minimum is 0.200 mm"],
    ])
  })

  test("copper outside the board, and a via crossing the edge", () => {
    const outside = run({ tracks: [track("t0001", [{ x: 8, y: 0 }, { x: 12, y: 0 }])] })
    expect(coded(outside, "copper-edge").map((v) => v.message)).toEqual(["t0001 runs outside the board"])
    const crossing = run({ vias: [via("v0001", { x: 9.9, y: 0 })] })
    expect(coded(crossing, "copper-edge").map((v) => v.message)).toEqual(["v0001 crosses the board edge; the minimum gap to it is 0.200 mm"])
  })

  test("a track ending exactly on the edge crosses it rather than running outside", () => {
    const found = run({ tracks: [track("t0001", [{ x: 8, y: 0 }, { x: 10, y: 0 }])] })
    expect(coded(found, "copper-edge").map((v) => v.message)).toEqual(["t0001 crosses the board edge; the minimum gap to it is 0.200 mm"])
  })

  test("no outline, no edge check", () => {
    const found = copperChecks(layoutOf({ tracks: [track("t0001", [{ x: 8, y: 0 }, { x: 12, y: 0 }])] }), RULES, asDefault)
    expect(ids(found, "copper-edge")).toEqual([])
  })
})

describe("keepouts", () => {
  const through = track("t0001", [{ x: 3, y: 5 }, { x: 7, y: 5 }])

  test("a track through a top keepout is an error naming both", () => {
    const found = run({ board: boardWith([keepout("keepout:1", "top")]), tracks: [through] })
    expect(coded(found, "copper-keepout").map((v) => [v.id, v.items, v.message])).toEqual([
      ["copper-keepout:t0001|keepout:1", ["keepout:1", "t0001"], "t0001 lies inside keepout:1"],
    ])
  })

  test("a bottom track passes a top keepout; an all-layer keepout catches a via", () => {
    expect(ids(run({ board: boardWith([keepout("keepout:1", "top")]), tracks: [{ ...through, layer: "bottom" }] }), "copper-keepout")).toEqual([])
    const found = run({ board: boardWith([keepout("keepout:1", "all")]), vias: [via("v0001", { x: 5, y: 5 })] })
    expect(ids(found, "copper-keepout")).toEqual(["copper-keepout:v0001|keepout:1"])
  })

  test("touching the keepout's edge is allowed", () => {
    const along = track("t0001", [{ x: 2, y: 3.875 }, { x: 8, y: 3.875 }])
    expect(ids(run({ board: boardWith([keepout("keepout:1", "all")]), tracks: [along] }), "copper-keepout")).toEqual([])
  })
})

describe("order", () => {
  test("the same copper in another order gives the same findings, sorted by id", () => {
    const tracks = [BASE, across(0.4), across(-0.4, {}, "t0003"), track("t0004", [{ x: -2, y: 9.9 }, { x: 2, y: 9.9 }], { width: 0.1 })]
    const vias = [via("v0001", { x: 0, y: 1 }, { net: "net.C", diameter: 0.5 })]
    const forward = run({ tracks, vias })
    const backward = run({ tracks: [...tracks].reverse(), vias })
    expect(backward).toEqual(forward)
    expect(forward.map((v) => v.id)).toEqual([...forward.map((v) => v.id)].sort())
    expect(forward.length).toBeGreaterThan(4)
  })
})

describe("hole spacing of vias", () => {
  test("two vias, of one net or two, keep the hole spacing", () => {
    expect(ids(run({ vias: [via("v0001", { x: 0, y: 0 }), via("v0002", { x: 0.7, y: 0 })] }), "hole-to-hole")).toEqual(["hole-to-hole:v0001|v0002"])
    expect(ids(run({ vias: [via("v0001", { x: 0, y: 0 }), via("v0002", { x: 0.75, y: 0 })] }), "hole-to-hole")).toEqual([])
    const found = coded(run({ vias: [via("v0001", { x: 0, y: 0 }), via("v0002", { x: 0, y: 1.5 }, { net: "net.B" })] }, { ...RULES, fabrication: { ...RULES.fabrication, minHoleToHole: 3 } }), "hole-to-hole")
    expect(found.map((v) => [v.id, v.message])).toEqual([["hole-to-hole:v0001|v0002", "The holes of v0001 and v0002 are 1.200 mm apart; the minimum is 3.000 mm"]])
  })

  test("a via keeps the hole spacing from a through pad's hole, its own net's included", () => {
    const through = pad("P#1", { shape: "circle", width: 1.6, height: 1.6, layers: "through", drill: { width: 1, height: 1 }, net: "net.A" })
    expect(ids(run({ pads: [through], vias: [via("v0001", { x: 1, y: 0 })] }), "hole-to-hole")).toEqual(["hole-to-hole:P#1|v0001"])
    expect(ids(run({ pads: [through], vias: [via("v0001", { x: 1.11, y: 0 })] }), "hole-to-hole")).toEqual([])
  })
})
