import { describe, expect, test } from "vitest"
import type { LayoutRecord, TrackRecord, ViaRecord } from "../../src/core/layout-file.js"
import { padsUnder, resolveCopper } from "../../src/engine/copper.js"
import type { Net } from "../../src/engine/model.js"
import type { PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { ratsnest } from "../../src/engine/ratsnest.js"

function pad(component: string, number: string, x: number, net?: string, layers: WorldPad["layers"] = "top"): WorldPad {
  return { id: `${component}#${number}`, component, number, shape: "rect", x, y: 0, width: 1, height: 1, rotation: 0, layers, ...(net ? { net } : {}) }
}

function part(component: string, pads: WorldPad[]): PlacedFootprint {
  return { component, x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
}

function track(id: string, xs: [number, number][], extra: Partial<TrackRecord> = {}): TrackRecord {
  return { t: "track", id, layer: "top", width: 0.25, points: xs.map(([x, y]) => ({ x, y })), locked: false, by: "human", ...extra }
}

function via(id: string, x: number, y: number, extra: Partial<ViaRecord> = {}): ViaRecord {
  return { t: "via", id, at: { x, y }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human", ...extra }
}

const NETS: Net[] = [
  { id: "net.GND", names: ["GND"], pins: [] },
  { id: "net.VCC", names: ["VCC"], pins: [] },
]

/** A at x=0, B at x=10, C at x=20, all on net.GND; D at x=30 on net.VCC. */
const PARTS = [
  part("A", [pad("A", "1", 0, "net.GND")]),
  part("B", [pad("B", "1", 10, "net.GND")]),
  part("C", [pad("C", "1", 20, "net.GND", "through")]),
  part("D", [pad("D", "1", 30, "net.VCC")]),
]

const copper = (records: LayoutRecord[]) => resolveCopper(PARTS, records, NETS)
const lines = (records: LayoutRecord[]) => ratsnest(PARTS, copper(records).islands).map((l) => `${l.from}-${l.to}`)

describe("nets from copper", () => {
  test("a track between two pads takes their net and lists the pads", () => {
    const result = copper([track("t0001", [[0, 0], [10, 0]], { net: "VCC" })])
    expect(result.tracks).toEqual([expect.objectContaining({ id: "t0001", net: "net.GND", pads: ["A#1", "B#1"] })])
    expect(result.diagnostics).toEqual([])
  })

  test("a track touching a pad anywhere in its copper counts, not only at the centre", () => {
    expect(copper([track("t0001", [[0.4, 0.4], [5, 5]])]).tracks[0]?.pads).toEqual(["A#1"])
    expect(copper([track("t0001", [[0.6, 0], [5, 5]])]).tracks[0]?.pads).toEqual([])
  })

  test("a track on the bottom does not touch a top pad, but does touch a through pad", () => {
    const result = copper([track("t0001", [[0, 0], [20, 0]], { layer: "bottom" })])
    expect(result.tracks[0]?.pads).toEqual(["C#1"])
  })

  test("a track ending on another track of the same layer joins it", () => {
    const result = copper([track("t0001", [[0, 0], [5, 0], [5, 5]]), track("t0002", [[10, 0], [5.1, 2]])])
    expect(result.tracks.map((t) => t.net)).toEqual(["net.GND", "net.GND"])
    expect(lines([track("t0001", [[0, 0], [5, 0], [5, 5]]), track("t0002", [[10, 0], [5.1, 2]])])).toEqual(["B#1-C#1"])
  })

  test("a via joins a top track to a bottom track", () => {
    const records = [track("t0001", [[0, 0], [5, 3]]), via("v0001", 5, 3), track("t0002", [[5, 3], [20, 0]], { layer: "bottom" })]
    const result = copper(records)
    expect(result.vias).toEqual([expect.objectContaining({ id: "v0001", net: "net.GND" })])
    expect(lines(records)).toEqual(["A#1-B#1"])
  })

  test("tracks on different layers without a via stay apart", () => {
    const records = [track("t0001", [[0, 0], [5, 3]]), track("t0002", [[5, 3], [20, 0]], { layer: "bottom" })]
    expect(lines(records)).toEqual(["A#1-B#1", "B#1-C#1"])
  })

  test("a via on a pad joins the pad", () => {
    expect(copper([via("v0001", 10, 0)]).vias[0]?.net).toBe("net.GND")
  })

  test("copper comes out in file order", () => {
    const result = copper([track("t0002", [[0, 0], [10, 0]]), via("v0009", 10, 0), track("t0001", [[10, 0], [20, 0]])])
    expect(result.tracks.map((t) => t.id)).toEqual(["t0002", "t0001"])
  })
})

describe("short and floating", () => {
  test("copper touching pads of two nets is a short naming both nets", () => {
    const result = copper([track("t0001", [[20, 0], [30, 0]])])
    expect(result.diagnostics).toEqual([
      { code: "short", severity: "error", message: "t0001 joins the nets net.GND and net.VCC", items: ["net.GND", "net.VCC"] },
    ])
    expect(result.tracks[0]?.net).toBeUndefined()
  })

  test("a short through two tracks names every piece of copper", () => {
    const result = copper([track("t0001", [[0, 0], [5, 5]]), track("t0002", [[5, 5], [30, 0]])])
    expect(result.diagnostics[0]).toMatchObject({ code: "short", message: "t0001, t0002 join the nets net.GND and net.VCC" })
  })

  test("copper touching no pad keeps the net it names and is floating", () => {
    const result = copper([track("t0001", [[50, 50], [60, 50]], { net: "VCC" }), via("v0001", 60, 50)])
    expect(result.tracks[0]?.net).toBe("net.VCC")
    expect(result.vias[0]?.net).toBe("net.VCC")
    expect(result.diagnostics).toEqual([
      { code: "floating", severity: "warning", message: "t0001, v0001 touch no pad", items: ["t0001", "v0001"] },
    ])
  })

  test("a floating record naming an unknown net keeps the name as written; without a name it has no net", () => {
    const result = copper([track("t0001", [[50, 50], [60, 50]], { net: "SPARE" }), via("v0001", 80, 80)])
    expect(result.tracks[0]?.net).toBe("SPARE")
    expect(result.vias[0]?.net).toBeUndefined()
    expect(result.diagnostics.map((d) => d.items)).toEqual([["t0001"], ["v0001"]])
  })

  test("a net id in the record is understood as well as a name", () => {
    expect(copper([track("t0001", [[50, 50], [60, 50]], { net: "net.GND" })]).tracks[0]?.net).toBe("net.GND")
  })
})

describe("the ratsnest with copper", () => {
  test("without copper the ratsnest is unchanged", () => {
    expect(lines([])).toEqual(["A#1-B#1", "B#1-C#1"])
  })

  test("a connection joined by copper is dropped and the rest still spans the net", () => {
    expect(lines([track("t0001", [[0, 0], [10, 0]])])).toEqual(["B#1-C#1"])
    expect(lines([track("t0001", [[0, 0], [20, 0]])])).toEqual(["A#1-B#1"])
  })

  test("a fully routed net has no lines", () => {
    expect(lines([track("t0001", [[0, 0], [10, 0], [20, 0]])])).toEqual([])
  })
})

describe("pads under a point", () => {
  test("finds the pads whose copper holds the point on that layer", () => {
    expect(padsUnder(PARTS, { x: 10.3, y: 0.2 }, "top").map((p) => p.id)).toEqual(["B#1"])
    expect(padsUnder(PARTS, { x: 10, y: 0 }, "bottom")).toEqual([])
    expect(padsUnder(PARTS, { x: 20, y: 0 }, "inner1").map((p) => p.id)).toEqual(["C#1"])
  })
})
