import { describe, expect, test } from "vitest"
import { designatorPlacements, silkscreenWarnings } from "../../src/engine/fab/designators.js"
import { gerberFiles } from "../../src/engine/fab/layers.js"
import { PROFILES } from "../../src/engine/rules/profiles.js"
import type { FabricationProfile } from "../../src/engine/rules/schema.js"
import { readGerber } from "../helpers/gerber-read.js"
import { board, pad, part } from "../helpers/fab-board.js"

const PROFILE = PROFILES["jlcpcb-2layer"] as FabricationProfile
const CREATED = new Date(Date.UTC(2026, 10, 10))
const EXPANSION = 0.05

/** A pad of another part, U9, at (x, y): 1 x 0.6 mm, so its mask opening is 1.1 x 0.7 mm. */
const blocker = (number: string, x: number, y: number, layers: "top" | "bottom" = "top") => pad(number, { x, y, layers, id: `U9#${number}`, component: "U9" })
/** U9 itself sits well to the right, so its own designator is out of the way. */
const others = (...pads: ReturnType<typeof blocker>[]) =>
  part(pads, { component: "U9", x: 8.5, courtyard: [{ x: 8, y: -1 }, { x: 9, y: -1 }, { x: 9, y: 1 }, { x: 8, y: 1 }] })
const round = (value: number) => Math.round(value * 1e9) / 1e9 + 0
/** Where the designator of `name` went, to the nanometre. */
function at(parts: Parameters<typeof designatorPlacements>[0], name = "P1") {
  const found = designatorPlacements(parts, EXPANSION).find((p) => p.component === name)?.at
  return found && { x: round(found.x), y: round(found.y) }
}

// P1's courtyard is ±1 mm and its designator "P1" is 1 mm tall and 10/6 mm wide, so its edge sits on the courtyard:
// above at (0, 1.5), below at (0, -1.5), left at (-11/6, 0), right at (11/6, 0).
describe("where each designator goes on the silkscreen", () => {
  test("above the courtyard when nothing is there", () => {
    expect(at([part([])])).toEqual({ x: 0, y: 1.5 })
  })

  test("below, then left, then right, when the sides before it overlap another part's mask opening", () => {
    expect(at([part([]), others(blocker("1", 0, 2))])).toEqual({ x: 0, y: -1.5 })
    expect(at([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2))])).toEqual({ x: round(-11 / 6), y: 0 })
    expect(at([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2), blocker("3", -2, 0))])).toEqual({ x: round(11 / 6), y: 0 })
  })

  test("a pad on the other side of the board is not in the way; a through pad is on both", () => {
    expect(at([part([]), others(blocker("1", 0, 2, "bottom"))])).toEqual({ x: 0, y: 1.5 })
    expect(at([part([]), others(pad("1", { x: 0, y: 2, layers: "through", drill: { width: 0.3, height: 0.3 }, component: "U9" }))])).toEqual({ x: 0, y: -1.5 })
  })

  test("a designator another part's pcbNameAt put there is avoided too", () => {
    const pinned = part([], { component: "P2", x: 6, courtyard: [], nameAt: { x: 0, y: 1.6 } })
    expect(at([part([]), pinned])).toEqual({ x: 0, y: -1.5 })
    expect(at([part([]), pinned], "P2")).toEqual({ x: 0, y: 1.6 })
  })

  test("when every side is taken it stays above, and the export warns which part's pads it covers", () => {
    const pcb = board({ parts: [part([]), others(blocker("1", 0, 2), blocker("2", 0, -2), blocker("3", -2, 0), blocker("4", 2, 0))] })
    expect(at(pcb.parts)).toEqual({ x: 0, y: 1.5 })
    expect(silkscreenWarnings(pcb, PROFILE)).toEqual(["P1's silkscreen overlaps U9's pads"])
  })

  test("a pcbNameAt keeps its place, and a warning when it covers pads or another designator", () => {
    const pinned = part([], { nameAt: { x: 0, y: 2 } })
    const pcb = board({ parts: [pinned, others(blocker("1", 0, 2)), part([], { component: "P2", x: 6, courtyard: [], nameAt: { x: 0.5, y: 2.2 } })] })
    expect(at(pcb.parts)).toEqual({ x: 0, y: 2 })
    expect(silkscreenWarnings(pcb, PROFILE)).toEqual(["P1's silkscreen overlaps U9's pads and P2's designator", "P2's silkscreen overlaps U9's pads and P1's designator"])
    expect(silkscreenWarnings(board({ parts: [part([])] }), PROFILE)).toEqual([])
  })

  test("the silkscreen file draws the designator where it was placed", () => {
    const pcb = board({ parts: [part([]), others(blocker("1", 0, 2))] })
    const silk = readGerber(gerberFiles(pcb, PROFILE, "b", CREATED).find((f) => f.file === "b-F_Silkscreen.gto")?.text ?? "")
    const ys = silk.strokes.flatMap((s) => s.points.filter((p) => p.x < 5).map((p) => p.y))
    expect(Math.max(...ys)).toBeCloseTo(-1, 6)
    expect(Math.min(...ys)).toBeCloseTo(-2, 6)
  })
})
