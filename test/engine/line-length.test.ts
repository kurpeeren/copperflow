import { describe, expect, test } from "vitest"
import { netLength } from "../../src/engine/line-length.js"
import type { Point } from "../../src/engine/model.js"
import type { PcbLayout, PcbTrack, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"

const pad = (id: string, x: number, y: number): WorldPad => ({
  number: "1",
  shape: "rect",
  x,
  y,
  width: 1,
  height: 1,
  rotation: 0,
  layers: "through",
  id,
  component: id.split("#")[0] ?? id,
  net: "net.A",
})
const track = (id: string, points: Point[], pads: string[], extra: Partial<PcbTrack> = {}): PcbTrack => ({
  id,
  net: "net.A",
  layer: "top",
  width: 0.25,
  points,
  locked: false,
  by: "human",
  pads,
  ...extra,
})
const via = (id: string, at: Point): PcbVia => ({ id, net: "net.A", at, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" })

function layout(pads: WorldPad[], tracks: PcbTrack[], vias: PcbVia[] = []): PcbLayout {
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { parts: [part], ratsnest: [], tracks, vias, pours: [], holes: [] }
}

describe("the true length of a net (F4)", () => {
  test("a straight run from pad to pad", () => {
    const found = netLength("net.A", layout([pad("U1#1", 0, 0), pad("J1#1", 10, 0)], [track("t1", [{ x: 0, y: 0 }, { x: 10, y: 0 }], ["U1#1", "J1#1"])]), 1.6)
    expect(found).toMatchObject({ length: 10, from: "J1#1", to: "U1#1", vias: 0 })
  })

  test("a branch that leads nowhere is not counted", () => {
    const main = track("t1", [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], ["U1#1", "J1#1"])
    const stub = track("t2", [{ x: 5, y: 0 }, { x: 5, y: 7 }], [])
    expect(netLength("net.A", layout([pad("U1#1", 0, 0), pad("J1#1", 10, 0)], [main, stub]), 1.6)?.length).toBeCloseTo(10, 6)
  })

  test("a via adds the board's thickness", () => {
    const a = track("t1", [{ x: 0, y: 0 }, { x: 5, y: 0 }], ["U1#1"])
    const b = track("t2", [{ x: 5, y: 0 }, { x: 10, y: 0 }], ["J1#1"], { layer: "bottom" })
    const found = netLength("net.A", layout([pad("U1#1", 0, 0), pad("J1#1", 10, 0)], [a, b], [via("v1", { x: 5, y: 0 })]), 1.6)
    expect(found?.length).toBeCloseTo(11.6, 6)
    expect(found?.vias).toBe(1)
  })

  test("an arc counts by its arc length", () => {
    const r = 5
    const arc = Array.from({ length: 91 }, (_, i) => ({ x: r * Math.cos((i * Math.PI) / 180), y: r * Math.sin((i * Math.PI) / 180) }))
    const found = netLength("net.A", layout([pad("U1#1", 5, 0), pad("J1#1", 0, 5)], [track("t1", arc, ["U1#1", "J1#1"])]), 1.6)
    expect(found?.length).toBeCloseTo((Math.PI * r) / 2, 3)
  })

  test("a three-pad net: the longest pad-to-pad path, and which pads", () => {
    const t1 = track("t1", [{ x: 0, y: 0 }, { x: 4, y: 0 }], ["U1#1"])
    const t2 = track("t2", [{ x: 4, y: 0 }, { x: 4, y: 3 }], ["C1#1"])
    const t3 = track("t3", [{ x: 4, y: 0 }, { x: 12, y: 0 }], ["J1#1"])
    const found = netLength("net.A", layout([pad("U1#1", 0, 0), pad("C1#1", 4, 3), pad("J1#1", 12, 0)], [t1, t2, t3]), 1.6)
    expect(found).toMatchObject({ from: "J1#1", to: "U1#1" })
    expect(found?.length).toBeCloseTo(12, 6)
  })

  test("a net with no copper has no length", () => {
    expect(netLength("net.A", layout([pad("U1#1", 0, 0), pad("J1#1", 10, 0)], []), 1.6)).toBeUndefined()
  })
})
