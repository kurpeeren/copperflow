import { describe, expect, test } from "vitest"
import { designatorPlacements, silkscreenWarnings } from "../../src/engine/fab/designators.js"
import { gerberFiles } from "../../src/engine/fab/layers.js"
import { textStrokes } from "../../src/engine/fab/stroke-font.js"
import type { PcbLayout } from "../../src/engine/pcb.js"
import { PROFILES } from "../../src/engine/rules/profiles.js"
import type { FabricationProfile } from "../../src/engine/rules/schema.js"
import { readGerber } from "../helpers/gerber-read.js"
import { board, pad, part, via } from "../helpers/fab-board.js"

const PROFILE = PROFILES["jlcpcb-2layer"] as FabricationProfile
const CREATED = new Date(Date.UTC(2026, 10, 10))
const EXPANSION = 0.05

/** A pad of another part, U9, at (x, y): 1 x 0.6 mm, so its mask opening is 1.1 x 0.7 mm. */
const blocker = (number: string, x: number, y: number, layers: "top" | "bottom" = "top") => pad(number, { x, y, layers, id: `U9#${number}`, component: "U9" })
/** U9 itself sits well to the right, so its own designator is out of the way. */
const others = (...pads: ReturnType<typeof blocker>[]) =>
  part(pads, { component: "U9", x: 8.5, courtyard: [{ x: 8, y: -1 }, { x: 9, y: -1 }, { x: 9, y: 1 }, { x: 8, y: 1 }] })
const round = (value: number) => Math.round(value * 1e9) / 1e9 + 0
const placed = (pcb: PcbLayout | PcbLayout["parts"], name = "P1") => designatorPlacements(Array.isArray(pcb) ? { parts: pcb } : pcb, EXPANSION).find((p) => p.component === name)
/** Where the designator of `name` went, to the nanometre. */
function at(pcb: PcbLayout | PcbLayout["parts"], name = "P1") {
  const found = placed(pcb, name)?.at
  return found && { x: round(found.x), y: round(found.y) }
}
const turn = (pcb: PcbLayout | PcbLayout["parts"], name = "P1") => placed(pcb, name)?.rotation

// P1's courtyard is ±1 mm and its designator "P1" is 1 mm tall and 10/6 mm wide; with the stroke's half width its ink
// is 0.575 mm from its middle across, and it keeps the 0.15 mm silkscreen clearance from the courtyard: above at
// (0, 1.725), below at (0, -1.725), standing on the left at (-1.725, 0), on the right at (1.725, 0).
describe("where each designator goes on the silkscreen", () => {
  test("above the courtyard when nothing is there", () => {
    expect(at([part([])])).toEqual({ x: 0, y: 1.725 })
    expect(turn([part([])])).toBe(0)
  })

  test("below, then on the left, then on the right, when the sides before it overlap another part's mask opening", () => {
    expect(at([part([]), others(blocker("1", 0, 2))])).toEqual({ x: 0, y: -1.725 })
    expect(at([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2))])).toEqual({ x: -1.725, y: 0 })
    expect(turn([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2))])).toBe(90)
    expect(at([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2), blocker("3", -2, 0))])).toEqual({ x: 1.725, y: 0 })
  })

  test("further out when every place at the clearance is taken: still within 2 mm of the courtyard", () => {
    const p = placed([part([]), others(blocker("1", 0, 2), blocker("2", 0, -2), blocker("3", -2, 0), blocker("4", 2, 0))])
    expect(p && { x: round(p.at.x), y: round(p.at.y), rotation: p.rotation }).toEqual({ x: 0, y: 3.325, rotation: 0 })
    expect(p?.coversPads).toEqual([])
  })

  test("a pad on the other side of the board is not in the way; a through pad is on both", () => {
    expect(at([part([]), others(blocker("1", 0, 2, "bottom"))])).toEqual({ x: 0, y: 1.725 })
    expect(at([part([]), others(pad("1", { x: 0, y: 2, layers: "through", drill: { width: 0.3, height: 0.3 }, component: "U9" }))])).toEqual({ x: 0, y: -1.725 })
  })

  test("a designator another part's pcbNameAt put there is avoided too", () => {
    const pinned = part([], { component: "P2", x: 6, courtyard: [], nameAt: { x: 0, y: 1.6 } })
    expect(at([part([]), pinned])).toEqual({ x: 0, y: -1.725 })
    expect(at([part([]), pinned], "P2")).toEqual({ x: 0, y: 1.6 })
  })

  test("another part's courtyard, a via, a hole and the board's edge are in the way", () => {
    const neighbour = part([], { component: "P2", x: 0, y: 2.5, courtyard: [{ x: -1, y: 1.2 }, { x: 1, y: 1.2 }, { x: 1, y: 3.8 }, { x: -1, y: 3.8 }] })
    expect(at([part([]), neighbour])).toEqual({ x: 0, y: -1.725 })
    expect(at(board({ parts: [part([])], vias: [via(0, 1.8)] }))).toEqual({ x: 0, y: -1.725 })
    const hole = { id: "hole:1", x: 0, y: 1.8, diameter: 0.5, source: { file: "a", line: 1, column: 1, offset: 0 } }
    expect(at(board({ parts: [part([])], holes: [hole] }))).toEqual({ x: 0, y: -1.725 })
    // Against the top edge (y = 5) the text above would run off the board.
    expect(at(board({ parts: [part([], { y: 3.5, courtyard: [{ x: -1, y: 2.5 }, { x: 1, y: 2.5 }, { x: 1, y: 4.5 }, { x: -1, y: 4.5 }] })] }))).toEqual({ x: 0, y: 1.775 })
  })

  test("when no place is clear it takes the least bad one, and the export warns which part's pads it covers", () => {
    const wide = pad("1", { x: 0, y: 0, width: 9, height: 9, id: "U9#1", component: "U9" })
    const pcb = board({ parts: [part([]), part([wide], { component: "U9", x: 8.5, courtyard: [] })] })
    expect(silkscreenWarnings(pcb, PROFILE)).toEqual(["P1's silkscreen overlaps U9's pads"])
    expect(placed(pcb)).toEqual(placed(pcb))
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
    expect(Math.max(...ys)).toBeCloseTo(-1.225, 6)
    expect(Math.min(...ys)).toBeCloseTo(-2.225, 6)
  })
})

/** A part 1 mm wide and 3 mm tall (standing), or 3 mm wide and 1 mm tall (lying), at the origin. */
const shaped = (standing: boolean, fields = {}) =>
  part([], {
    courtyard: standing
      ? [{ x: -0.5, y: -1.5 }, { x: 0.5, y: -1.5 }, { x: 0.5, y: 1.5 }, { x: -0.5, y: 1.5 }]
      : [{ x: -1.5, y: -0.5 }, { x: 1.5, y: -0.5 }, { x: 1.5, y: 0.5 }, { x: -1.5, y: 0.5 }],
    ...fields,
  })

describe("a designator turned along its part", () => {
  test("a standing part gets a standing name beside its long side, a lying part a flat one", () => {
    expect(turn([shaped(true)])).toBe(90)
    expect(at([shaped(true)])).toEqual({ x: -1.225, y: 0 })
    expect(turn([shaped(false)])).toBe(0)
    expect(at([shaped(false)])).toEqual({ x: 0, y: 1.225 })
  })

  test("a turned name reads from the bottom up, never upside down", () => {
    const strokes = textStrokes("P1", { x: 0, y: 0 }, 1, false, true)
    const first = strokes.slice(0, 1).flat()
    const last = strokes.slice(-1).flat()
    expect(Math.max(...first.map((p) => p.y))).toBeLessThan(Math.min(...last.map((p) => p.y)))
    // One character tall across x, centred on the anchor.
    const xs = strokes.flat().map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 6)
    expect(Math.max(...xs)).toBeCloseTo(0.5, 6)
  })

  test("a person's pcbNameAt and turn are kept, and the others go round them", () => {
    const pinned = shaped(true, { nameAt: { x: 0, y: 1.725 }, nameRotation: 90 })
    const other = part([], { component: "P2", x: 0, y: 3.2, courtyard: [{ x: -1, y: 2.95 }, { x: 1, y: 2.95 }, { x: 1, y: 3.45 }, { x: -1, y: 3.45 }] })
    const pcb = board({ parts: [other, pinned] })
    expect(placed(pcb)).toMatchObject({ at: { x: 0, y: 1.725 }, rotation: 90 })
    const p2 = placed(pcb, "P2")
    expect(p2?.coversDesignators).toEqual([])
    expect(p2?.at.y).toBeGreaterThan(3.45)
  })

  test("pcbNameRotation alone turns the name wherever the program puts it", () => {
    expect(turn([shaped(true, { nameRotation: 0 })])).toBe(0)
    expect(turn([shaped(false, { nameRotation: 90 })])).toBe(90)
  })

  test("the silkscreen file writes a turned designator turned", () => {
    const pcb = board({ parts: [shaped(true)] })
    const silk = readGerber(gerberFiles(pcb, PROFILE, "b", CREATED).find((f) => f.file === "b-F_Silkscreen.gto")?.text ?? "")
    const points = silk.strokes.flatMap((s) => s.points)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    // One character tall across x; along y as long as the flat text is wide.
    const flat = textStrokes("P1", { x: 0, y: 0 }, 1).flat().map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.max(...flat) - Math.min(...flat), 6)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(-1.225, 6)
  })
})

describe("copies of one sheet's part", () => {
  const copy = (name: string, x: number) =>
    part([], { component: name, x, copyOf: "Input/R1", courtyard: [{ x: x - 1.5, y: -0.5 }, { x: x + 1.5, y: -0.5 }, { x: x + 1.5, y: 0.5 }, { x: x - 1.5, y: 0.5 }] })
  const offsets = (pcb: PcbLayout) => designatorPlacements(pcb, EXPANSION).map((p) => `${round(p.at.x - (pcb.parts.find((q) => q.component === p.component)?.x ?? 0))},${round(p.at.y)},${p.rotation}`)

  test("take the same place round their parts when it is clear for all of them", () => {
    // A pad above the second copy: no copy goes above, so all three go below, alike.
    const pcb = board({ parts: [copy("R101", -6), copy("R201", 0), copy("R301", 6), others(blocker("1", 0, 1.3))] })
    expect(offsets(pcb).slice(0, 3)).toEqual(["0,-1.225,0", "0,-1.225,0", "0,-1.225,0"])
  })

  test("a copy with no room there takes its own place, the others keep theirs", () => {
    const pcb = board({ parts: [copy("R101", -6), copy("R201", 0), copy("R301", 6), part([pad("1", { x: 0, y: 0, width: 6, height: 6, id: "U9#1", component: "U9" })], { component: "U9", x: 0, courtyard: [] })] })
    const [a, b, c] = offsets(pcb).map((o) => o.split(",").slice(1).join(","))
    // R201's top and bottom are under U9's pad: the other two take the same side, R201 its own place.
    expect(a).toBe(c)
    expect(b).not.toBe(a)
  })
})

describe("the board's own silkscreen texts", () => {
  const text = (id: string, words: string, x: number, y: number, layer: "top" | "bottom" = "top") =>
    ({ id, text: words, x, y, layer, height: 1, rotation: 0, source: { file: "main.circuit.tsx", line: 1, column: 1 } }) as unknown as NonNullable<PcbLayout["silkTexts"]>[number]

  test("a designator goes round a text as it goes round another part's pads", () => {
    expect(at({ parts: [part([])], silkTexts: [text("silkscreentext:1", "5V", 0, 1.8)] } as PcbLayout)).toEqual({ x: 0, y: -1.725 })
  })

  test("a text on the other side is not in the way", () => {
    expect(at({ parts: [part([])], silkTexts: [text("silkscreentext:1", "5V", 0, 1.8, "bottom")] } as PcbLayout)).toEqual({ x: 0, y: 1.725 })
  })

  test("a designator with no other place says which text it lies on", () => {
    // One big text over the part and every place within 2 mm round it.
    const ring = [{ ...text("silkscreentext:1", "MMMM", 0, 0), height: 10 }]
    const crowded = { parts: [part([], { courtyard: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] })], silkTexts: ring } as unknown as PcbLayout
    const found = placed(crowded)
    expect(found?.coversTexts.length).toBeGreaterThan(0)
    expect(silkscreenWarnings(crowded, PROFILE).join(" ")).toContain(`P1's silkscreen overlaps the text "MMMM"`)
  })
})
