import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { placeBoard, type Placement } from "../../src/engine/pcb-place/index.js"
import type { WorldPad } from "../../src/engine/pcb.js"
import { filesIn, withPositions } from "../helpers/place-fixtures.js"
import { routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof-3")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"
/** The total ratsnest length the placer reached on this board before satellites were kept beside their pins (mm). */
const WIRE_BEFORE = 174.9

/** The CAN board of the third proof run with no part placed and no copper. */
function unplaced(): Record<string, string> {
  const files = filesIn(FOLDER)
  const main = (files[MAIN] as string).replace(/ pcbX=\{[^}]*\} pcbY=\{[^}]*\} pcbRotation=\{[^}]*\}/g, "")
  return { ...files, [MAIN]: main, [LAYOUT]: `${(files[LAYOUT] as string).split("\n")[0]}\n` }
}

const padsOf = (design: Design, part: string): WorldPad[] => design.pcb.parts.find((p) => p.component === part)?.pads ?? []
/** Half a pad's size along x and y on the board. */
const half = (p: WorldPad) => (Math.round(p.rotation / 90) % 2 === 0 ? { x: p.width / 2, y: p.height / 2 } : { x: p.height / 2, y: p.width / 2 })
/**
 * The copper gap between two pads, edge to edge: what a track between them crosses. Centre to centre a 4.9 mm HC49
 * crystal cannot come within 4 mm of both oscillator pins of a SOIC, whose pins are 1.27 mm apart, nor a 0603
 * capacitor within 3 mm of an HC49 pad, whose courtyard reaches 3.4 mm past it.
 */
function gap(a: WorldPad, b: WorldPad): number {
  const [ha, hb] = [half(a), half(b)]
  return Math.hypot(Math.max(0, Math.abs(a.x - b.x) - ha.x - hb.x), Math.max(0, Math.abs(a.y - b.y) - ha.y - hb.y))
}
/** The shortest copper gap from one of `part`'s pads on `net` to one of `other`'s. */
function nearest(design: Design, part: string, other: string, net?: string): number {
  const mine = padsOf(design, part).filter((p) => net === undefined || p.net === net)
  const theirs = padsOf(design, other).filter((p) => net === undefined || p.net === net)
  return Math.min(...mine.flatMap((a) => theirs.map((b) => gap(a, b))))
}

describe("the placer keeps a chip's satellites beside their pins", () => {
  const files = unplaced()
  const placement: Placement = placeBoard(buildDesign(files, MAIN))
  const placed = buildDesign({ ...files, [MAIN]: withPositions(files[MAIN] as string, placement.positions) }, MAIN)

  test("the crystal sits within 4 mm (copper gap) of the chip's two oscillator pins", () => {
    expect(placement.unplaced).toEqual([])
    expect(nearest(placed, "Y1", "U1", "net.OSC1")).toBeLessThanOrEqual(4)
    expect(nearest(placed, "Y1", "U1", "net.OSC2")).toBeLessThanOrEqual(4)
  })

  test("each load capacitor sits within 3 mm of a crystal pad, on the side away from the chip", () => {
    const chipSide = (part: string) => (padsOf(placed, part)[0]?.x ?? 0) > (padsOf(placed, "Y1")[0]?.x ?? 0)
    // The chip's oscillator pins are on the crystal's right here (x larger): both capacitors are on its left.
    expect(padsOf(placed, "U1").find((p) => p.net === "net.OSC1")?.x ?? 0).toBeGreaterThan(padsOf(placed, "Y1")[0]?.x ?? 0)
    expect([chipSide("C2"), chipSide("C3")]).toEqual([false, false])
    expect(nearest(placed, "C2", "Y1", "net.OSC1")).toBeLessThanOrEqual(3)
    expect(nearest(placed, "C3", "Y1", "net.OSC2")).toBeLessThanOrEqual(3)
  })

  test("a pull-up sits beside the pin it serves, an LED's resistor beside the LED", () => {
    expect(nearest(placed, "R1", "U1", "net.NRST")).toBeLessThanOrEqual(4)
    expect(nearest(placed, "R3", "D1", "net.LED_A")).toBeLessThanOrEqual(3)
  })

  test("the total wire length is no worse than before, and at most 160 mm (157.2 when written)", () => {
    expect(placement.score.wireLength).toBeLessThanOrEqual(WIRE_BEFORE)
    expect(placement.score.wireLength).toBeLessThanOrEqual(160)
  })

  test("after autoroute every connection is routed and OSC1 and OSC2 each take at most 12 mm of track (8.6 and 8.5 when written)", () => {
    const report = routeDesign(placed)
    expect(report.unrouted).toEqual([])
    const length = (net: string) =>
      report.routed
        .filter((route) => route.net === net)
        .flatMap((route) => route.copper.tracks)
        .reduce((sum, track) => sum + track.points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - (track.points[i] as WorldPad).x, p.y - (track.points[i] as WorldPad).y), 0), 0)
    expect(length("net.OSC1")).toBeGreaterThan(0)
    expect(length("net.OSC1")).toBeLessThanOrEqual(12)
    expect(length("net.OSC2")).toBeGreaterThan(0)
    expect(length("net.OSC2")).toBeLessThanOrEqual(12)
  }, 120_000)

  test("the same board places the same way twice", () => {
    const again = placeBoard(buildDesign(files, MAIN))
    expect([...again.positions]).toEqual([...placement.positions])
  })

  test("a crystal a person placed still keeps its load capacitors on its side away from the chip", () => {
    const main = (files[MAIN] as string)
      .replace('name="U1"', 'name="U1" pcbX={1.5} pcbY={-0.5} pcbRotation={0}')
      .replace('name="Y1"', 'name="Y1" pcbX={-7.3} pcbY={-3.675} pcbRotation={90}')
    const result = placeBoard(buildDesign({ ...files, [MAIN]: main }, MAIN))
    const board = buildDesign({ ...files, [MAIN]: withPositions(main, result.positions) }, MAIN)
    const crystalX = padsOf(board, "Y1")[0]?.x ?? 0
    // The chip is on the crystal's right: each capacitor's crystal-side pad is left of the crystal's pads.
    for (const [cap, net] of [["C2", "net.OSC1"], ["C3", "net.OSC2"]] as const) {
      expect(padsOf(board, cap).find((p) => p.net === net)?.x ?? 0).toBeLessThan(crystalX)
      expect(nearest(board, cap, "Y1", net)).toBeLessThanOrEqual(3)
    }
  })

  test("a part a person placed stays where it is", () => {
    const pinned = (files[MAIN] as string).replace('name="Y1"', 'name="Y1" pcbX={10} pcbY={-8} pcbRotation={0}')
    const result = placeBoard(buildDesign({ ...files, [MAIN]: pinned }, MAIN))
    expect(result.positions.has("Y1")).toBe(false)
  })
})
