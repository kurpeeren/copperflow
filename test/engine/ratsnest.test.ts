import { describe, expect, test } from "vitest"
import type { PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { ratsnest } from "../../src/engine/ratsnest.js"

function pad(component: string, number: string, x: number, net?: string, y = 0): WorldPad {
  return { id: `${component}#${number}`, component, number, shape: "rect", x, y, width: 1, height: 1, rotation: 0, layers: "top", ...(net ? { net } : {}) }
}

function part(component: string, pads: WorldPad[]): PlacedFootprint {
  return { component, x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
}

const pairs = (lines: ReturnType<typeof ratsnest>) => lines.map((l) => [l.from, l.to])

describe("ratsnest", () => {
  test("ratsnest is a minimum spanning tree", () => {
    const lines = ratsnest([part("A", [pad("A", "1", 0, "net.GND")]), part("B", [pad("B", "1", 1, "net.GND")]), part("C", [pad("C", "1", 5, "net.GND")])])
    expect(lines).toEqual([
      { net: "net.GND", from: "A#1", to: "B#1", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { net: "net.GND", from: "B#1", to: "C#1", a: { x: 1, y: 0 }, b: { x: 5, y: 0 } },
    ])
  })

  test("the tree is shorter than a star from the first pad", () => {
    const lines = ratsnest([part("A", [pad("A", "1", 0, "n")]), part("B", [pad("B", "1", 5, "n")]), part("C", [pad("C", "1", 6, "n")])])
    expect(pairs(lines)).toEqual([["A#1", "B#1"], ["B#1", "C#1"]])
  })

  test("ties break by pad id", () => {
    const lines = ratsnest([part("A", [pad("A", "1", 0, "n")]), part("B", [pad("B", "1", 1, "n")]), part("C", [pad("C", "1", -1, "n")])])
    expect(pairs(lines)).toEqual([["A#1", "B#1"], ["A#1", "C#1"]])
  })

  test("pads of one pin take part like any other", () => {
    const u1 = part("U1", [pad("U1", "9", 0, "n"), { ...pad("U1", "9", 2, "n"), id: "U1#9#2" }])
    const lines = ratsnest([u1, part("R1", [pad("R1", "1", 3, "n")])])
    expect(pairs(lines)).toEqual([["R1#1", "U1#9#2"], ["U1#9#2", "U1#9"]])
  })

  test("nets are separate and unconnected pads are ignored", () => {
    const lines = ratsnest([
      part("A", [pad("A", "1", 0, "n1"), pad("A", "2", 0, undefined, 3)]),
      part("B", [pad("B", "1", 4, "n1"), pad("B", "2", 4, "n2")]),
      part("C", [pad("C", "1", 9, "n2")]),
    ])
    expect(lines.map((l) => l.net)).toEqual(["n1", "n2"])
  })

  test("a net with one pad has no lines", () => {
    expect(ratsnest([part("A", [pad("A", "1", 0, "n")])])).toEqual([])
  })
})
