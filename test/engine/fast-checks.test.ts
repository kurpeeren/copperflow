import { describe, expect, test } from "vitest"
import { fastLineChecks, measureLines } from "../../src/engine/checks/fast-lines.js"
import type { Net, Point } from "../../src/engine/model.js"
import type { PcbLayout, PcbTrack, PcbVia, PlacedFootprint, RatsnestLine, WorldPad } from "../../src/engine/pcb.js"
import { loadRules } from "../../src/engine/rules/load.js"

const NETS: Net[] = ["P", "N", "A0", "A1", "GND"].map((name) => ({ id: `net.${name}`, names: [name], pins: [] }))

const pad = (id: string, net: string, x: number, y: number): WorldPad => ({
  number: "1",
  shape: "rect",
  x,
  y,
  width: 0.5,
  height: 0.5,
  rotation: 0,
  layers: "top",
  id,
  component: id.split("#")[0] ?? id,
  net,
})
const track = (id: string, net: string, points: Point[], pads: string[], width = 0.3): PcbTrack => ({ id, net, layer: "top", width, points, locked: false, by: "human", pads })
const via = (id: string, net: string, at: Point): PcbVia => ({ id, net, at, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" })

function layoutOf(tracks: PcbTrack[], pads: WorldPad[], vias: PcbVia[] = [], ratsnest: RatsnestLine[] = []): PcbLayout {
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { parts: [part], ratsnest, tracks, vias, pours: [], holes: [] }
}

const PAIR_RULES = loadRules({
  "rules.yaml": "netClasses:\n  fast:\n    nets: [P, N]\n    pair: [[P, N]]\n    trackWidth: 0.3\n    gap: 0.2\n    maxSkew: 0.5\n    maxLength: 15\n",
}).rules

/** P along y = 0 and N along y = 0.5 (a 0.2 mm gap between 0.3 mm tracks), from x = 0 to `endN`. */
function pairBoard(endN = 10, extra: { gapN?: number; viasN?: PcbVia[] } = {}): PcbLayout {
  const yN = extra.gapN ?? 0.5
  const pads = [pad("U1#1", "net.P", 0, 0), pad("J1#1", "net.P", 10, 0), pad("U1#2", "net.N", 0, yN), pad("J1#2", "net.N", endN, yN)]
  const tracks = [track("t1", "net.P", [{ x: 0, y: 0 }, { x: 10, y: 0 }], ["U1#1", "J1#1"]), track("t2", "net.N", [{ x: 0, y: yN }, { x: endN, y: yN }], ["U1#2", "J1#2"])]
  return layoutOf(tracks, pads, extra.viasN ?? [])
}

const run = (layout: PcbLayout, rules = PAIR_RULES) => fastLineChecks(NETS, layout, rules, 1.6)
const messages = (layout: PcbLayout, rules = PAIR_RULES) => run(layout, rules).map((v) => `${v.code}: ${v.message}`)

describe("pair and length checks (F5)", () => {
  test("a clean pair has no finding", () => {
    expect(run(pairBoard())).toEqual([])
  })

  test("skew over maxSkew", () => {
    expect(messages(pairBoard(11))).toEqual(["pair-skew: Pair P and N: P is 10.0 mm, N is 11.0 mm, 1.0 mm apart; maxSkew is 0.5 mm"])
    expect(run(pairBoard(11))[0]?.at).toEqual({ x: 11, y: 0.5 })
  })

  test("a pair that is not side by side", () => {
    expect(messages(pairBoard(10, { gapN: 3 }))).toEqual([
      "pair-apart: Pair P and N runs side by side for 0 % of its length (within twice its 0.2 mm gap on one layer); the class's minCoupled is 80 %",
    ])
  })

  test("a gap off the class's value where it runs side by side", () => {
    expect(messages(pairBoard(10, { gapN: 0.6 }))).toEqual(["pair-gap: Pair P and N: the gap is 0.3 mm instead of 0.2 mm for 10.0 mm, from (0, 0)"])
  })

  test("a net longer than maxLength", () => {
    const rules = loadRules({ "rules.yaml": "netClasses:\n  fast:\n    nets: [P]\n    maxLength: 5\n" }).rules
    const layout = layoutOf([track("t1", "net.P", [{ x: 0, y: 0 }, { x: 10, y: 0 }], ["U1#1", "J1#1"])], [pad("U1#1", "net.P", 0, 0), pad("J1#1", "net.P", 10, 0)])
    expect(messages(layout, rules)).toEqual(["net-length: P is 10.0 mm long between J1#1 and U1#1; maxLength is 5 mm"])
  })

  test("a match group spread over maxSpread", () => {
    const rules = loadRules({ "rules.yaml": "netClasses:\n  bus:\n    nets: [A0, A1]\n    matchGroup: addr\n    maxSpread: 1\n" }).rules
    const pads = [pad("U1#1", "net.A0", 0, 0), pad("J1#1", "net.A0", 10, 0), pad("U1#2", "net.A1", 0, 2), pad("J1#2", "net.A1", 13, 2)]
    const tracks = [track("t1", "net.A0", [{ x: 0, y: 0 }, { x: 10, y: 0 }], ["U1#1", "J1#1"]), track("t2", "net.A1", [{ x: 0, y: 2 }, { x: 13, y: 2 }], ["U1#2", "J1#2"])]
    expect(messages(layoutOf(tracks, pads), rules)).toEqual([
      "match-spread: Match group addr spreads 3.0 mm, over its maxSpread of 1 mm: A0 10.0 mm, A1 13.0 mm; longest A1, shortest A0",
    ])
  })

  test("an impedance class routed wider than its width", () => {
    const layout = pairBoard()
    const wide = { ...layout, tracks: layout.tracks.map((t) => (t.id === "t2" ? { ...t, width: 0.4, points: [{ x: 0, y: 0.55 }, { x: 10, y: 0.55 }] } : t)) }
    expect(messages(wide).filter((m) => m.startsWith("impedance-width"))).toEqual(["impedance-width: t2 is 0.4 mm wide; the class fast routes at 0.3 mm"])
  })

  test("a pair with a different number of vias", () => {
    expect(messages(pairBoard(10, { viasN: [via("v1", "net.N", { x: 5, y: 0.5 })] }))).toEqual(["pair-vias: Pair P and N: P has 0 vias, N has 1"])
  })

  test("an unrouted net of such a class gives no second finding", () => {
    const layout = { ...pairBoard(11), ratsnest: [{ net: "net.N", from: "U1#2", to: "J1#2", a: { x: 0, y: 0.5 }, b: { x: 11, y: 0.5 } }] }
    expect(run(layout)).toEqual([])
  })

  test("nothing at all on a board without such classes", () => {
    const rules = loadRules({}).rules
    expect(run(pairBoard(11), rules)).toEqual([])
    expect(measureLines(NETS, pairBoard(11), rules, 1.6)).toBeUndefined()
  })
})
