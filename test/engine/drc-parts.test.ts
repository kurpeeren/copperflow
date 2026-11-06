import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { partChecks } from "../../src/engine/checks/drc-parts.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { ENGINE_FILES } from "../../src/engine/engine.js"
import type { Board, Keepout, Point } from "../../src/engine/model.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"
import { loadRules } from "../../src/engine/rules/load.js"

const MAIN = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))
const RULES = loadRules({}).rules

function design(body: string, board = true): Design {
  const inner = board ? `<board width="20mm" height="20mm">\n${body}\n</board>` : `<group>\n${body}\n</group>`
  return buildDesign({ [MAIN]: `export default () => (\n  ${inner}\n)\n` }, MAIN)
}

const run = (built: Design) => partChecks(built.pcb, built.rules)
const coded = <T extends { code: string }>(found: readonly T[], code: string): T[] => found.filter((v) => v.code === code)
const resistor = (name: string, x: number, layer = "top") => `<resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={0} layer="${layer}" />`

// ---- hand-made layouts ----

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function board(outline: Point[], keepouts: Keepout[] = []): Board {
  return { outline, layers: 2, thickness: 1.6, keepouts }
}

function part(component: string, overrides: Partial<PlacedFootprint> = {}): PlacedFootprint {
  return { component, x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads: [], courtyard: [], silkscreen: [], fabrication: [], ...overrides }
}

function pad(id: string, overrides: Partial<WorldPad> = {}): WorldPad {
  return { number: "1", shape: "rect", x: 0, y: 0, width: 1, height: 1, rotation: 0, layers: "top", id, component: id.split("#")[0] ?? id, ...overrides }
}

const layoutOf = (parts: PlacedFootprint[], b?: Board): PcbLayout => ({ ...(b ? { board: b } : {}), parts, ratsnest: [] })
const SQUARE = board(rectangle(-10, -10, 10, 10))

describe("courtyard-overlap", () => {
  test("two 0603 courtyards that overlap are an error naming both parts", () => {
    const found = coded(run(design(`${resistor("R1", 0)}\n${resistor("R2", 0.5)}`)), "courtyard-overlap")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "error", items: ["R1", "R2"], id: "courtyard-overlap:R1,R2" })
  })

  test("parts far apart do not overlap", () => {
    expect(coded(run(design(`${resistor("R1", 0)}\n${resistor("R2", 5)}`)), "courtyard-overlap")).toEqual([])
  })

  test("courtyards that only touch do not overlap", () => {
    const layout = layoutOf([part("A", { courtyard: rectangle(0, 0, 1, 1) }), part("B", { courtyard: rectangle(1, 0, 2, 1) })], SQUARE)
    expect(coded(partChecks(layout, RULES), "courtyard-overlap")).toEqual([])
  })

  test("a part on top and one on the bottom do not conflict", () => {
    expect(coded(run(design(`${resistor("R1", 0)}\n${resistor("R2", 0.5, "bottom")}`)), "courtyard-overlap")).toEqual([])
  })

  test("each pair is reported once among many parts", () => {
    const parts = ["A", "B", "C"].map((name) => part(name, { courtyard: rectangle(0, 0, 2, 2) }))
    const found = coded(partChecks(layoutOf(parts, SQUARE), RULES), "courtyard-overlap")
    expect(found.map((v) => v.items)).toEqual([["A", "B"], ["A", "C"], ["B", "C"]])
  })
})

describe("outside-board", () => {
  test("a part beyond the outline is a warning", () => {
    const found = coded(run(design(resistor("R1", 15))), "outside-board")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["R1"] })
  })

  test("a part inside the outline passes", () => {
    expect(coded(run(design(resistor("R1", 0))), "outside-board")).toEqual([])
  })

  test("a courtyard exactly on the outline passes", () => {
    const layout = layoutOf([part("A", { courtyard: rectangle(-10, -1, -8, 1) })], SQUARE)
    expect(coded(partChecks(layout, RULES), "outside-board")).toEqual([])
  })

  test("a courtyard that pokes out of a concave outline between its corners fails", () => {
    const ell = board([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ])
    const layout = layoutOf([part("A", { courtyard: rectangle(2, 2, 8, 8) }), part("B", { courtyard: rectangle(1, 5, 3, 9) })], ell)
    const found = coded(partChecks(layout, RULES), "outside-board")
    expect(found.map((v) => v.items)).toEqual([["A"]])
  })

  test("a courtyard with every corner inside the L outline fails when an edge crosses the notch", () => {
    const ell = board([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ])
    const triangle: Point[] = [{ x: 1, y: 9 }, { x: 9, y: 1 }, { x: 1, y: 1 }]
    const found = coded(partChecks(layoutOf([part("A", { courtyard: triangle })], ell), RULES), "outside-board")
    expect(found.map((v) => v.items)).toEqual([["A"]])
  })

  test("a part with no footprint uses the 1 x 1 mm fallback courtyard for overlap and the outline", () => {
    const built = design(
      `<resistor name="R1" footprint="0603" pcbX={0} pcbY={0} />\n<chip name="U1" pinCount={2} pcbX={0.3} pcbY={0} />\n<chip name="U2" pinCount={2} pcbX={10} pcbY={0} />`,
    )
    const found = run(built)
    expect(built.pcb.parts.find((p) => p.component === "U1")?.pads).toEqual([])
    expect(coded(found, "courtyard-overlap").map((v) => v.items)).toEqual([["R1", "U1"]])
    expect(coded(found, "outside-board").map((v) => v.items)).toEqual([["U2"]])
  })
})

describe("keepout", () => {
  const body = (layer: string) => `<keepout pcbX={0} pcbY={0} width={4} height={4} layers="top" />\n${resistor("R1", 0, layer)}`

  test("a round pad tangent to a keepout edge is fine", () => {
    const keepout: Keepout = { id: "keepout:1", outline: rectangle(0, 0, 2, 2), layers: "all", source: {} as Keepout["source"] }
    const round = pad("A#1", { shape: "circle", x: -0.5, y: 1, width: 1, height: 1 })
    const layout = layoutOf([part("A", { pads: [round] })], board(SQUARE.outline, [keepout]))
    expect(coded(partChecks(layout, RULES), "keepout")).toEqual([])
  })

  test("a pad inside a top keepout is an error naming the part and the keepout", () => {
    const found = coded(run(design(body("top"))), "keepout")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "error", items: ["keepout:1", "R1"] })
  })

  test("the same part on the bottom is not in a top keepout", () => {
    expect(coded(run(design(body("bottom"))), "keepout")).toEqual([])
  })

  test("a keepout on all layers catches a bottom part", () => {
    const text = `<keepout pcbX={0} pcbY={0} width={4} height={4} />\n${resistor("R1", 0, "bottom")}`
    expect(coded(run(design(text)), "keepout")).toHaveLength(1)
  })

  test("a through-hole pad is on both copper sides", () => {
    const keepout: Keepout = { id: "keepout:1", outline: rectangle(-2, -2, 2, 2), layers: "bottom", source: {} as Keepout["source"] }
    const layout = layoutOf([part("J1", { pads: [pad("J1#1", { layers: "through" })] })], board(SQUARE.outline, [keepout]))
    expect(coded(partChecks(layout, RULES), "keepout")).toHaveLength(1)
  })

  test("a courtyard on the keepout's layer overlaps it, one on the other layer does not", () => {
    const keepout: Keepout = { id: "keepout:1", outline: rectangle(-2, -2, 2, 2), layers: "top", source: {} as Keepout["source"] }
    const b = board(SQUARE.outline, [keepout])
    const top = layoutOf([part("A", { courtyard: rectangle(1, 1, 3, 3) })], b)
    const bottom = layoutOf([part("A", { side: "bottom", courtyard: rectangle(1, 1, 3, 3) })], b)
    expect(coded(partChecks(top, RULES), "keepout")).toHaveLength(1)
    expect(coded(partChecks(bottom, RULES), "keepout")).toEqual([])
  })

  test("a pad that only touches the keepout edge is fine", () => {
    const keepout: Keepout = { id: "keepout:1", outline: rectangle(0, 0, 2, 2), layers: "all", source: {} as Keepout["source"] }
    const layout = layoutOf([part("A", { pads: [pad("A#1", { x: -0.5, y: 1 })] })], board(SQUARE.outline, [keepout]))
    expect(coded(partChecks(layout, RULES), "keepout")).toEqual([])
  })
})

describe("silk-on-pad", () => {
  const silk = (x: number): Point[][] => [[{ x, y: -2 }, { x, y: 2 }]]
  const withSilk = (x: number, overrides: Partial<PlacedFootprint> = {}) =>
    layoutOf([part("A", { pads: [pad("A#1")], silkscreen: silk(x), ...overrides })], SQUARE)

  test("silk closer than minSilkToPad to a pad is a warning naming the part and the pad", () => {
    const found = coded(partChecks(withSilk(0.6), RULES), "silk-on-pad")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["A", "A#1"] })
  })

  test("silk across a pad is reported once per pad", () => {
    const found = coded(partChecks(withSilk(0), RULES), "silk-on-pad")
    expect(found).toHaveLength(1)
  })

  test("silk exactly minSilkToPad from a pad passes", () => {
    expect(coded(partChecks(withSilk(0.5 + RULES.fabrication.minSilkToPad), RULES), "silk-on-pad")).toEqual([])
  })

  test("silk well clear of the pad passes", () => {
    expect(coded(partChecks(withSilk(3), RULES), "silk-on-pad")).toEqual([])
  })

  test("silk on the other side is ignored", () => {
    const layout = layoutOf([part("A", { pads: [pad("A#1", { layers: "bottom" })], silkscreen: silk(0) })], SQUARE)
    expect(coded(partChecks(layout, RULES), "silk-on-pad")).toEqual([])
  })

  test("a through-hole pad is exposed on the part's side", () => {
    const layout = layoutOf([part("A", { pads: [pad("A#1", { layers: "through" })], silkscreen: silk(0) })], SQUARE)
    expect(coded(partChecks(layout, RULES), "silk-on-pad")).toHaveLength(1)
  })

  describe("against the pads of other parts", () => {
    /** U1's silk runs along y = 1.3 from x = -1 to 4, past its courtyard and through R2's first pad. */
    const across = (other: Partial<WorldPad> = {}) =>
      layoutOf(
        [
          part("U1", { courtyard: rectangle(-1, -1, 1, 0.5), pads: [pad("U1#1", { width: 0.5, height: 0.5 })], silkscreen: [[{ x: -1, y: 1.3 }, { x: 4, y: 1.3 }]] }),
          part("R2", { x: 3, y: 1.3, courtyard: rectangle(2, 0.55, 4, 2), pads: [pad("R2#1", { x: 3, y: 1.3, width: 0.8, height: 0.8, ...other })] }),
        ],
        SQUARE,
      )

    test("silk across a neighbour's pad names the part of the silk and that pad", () => {
      const found = partChecks(across(), RULES)
      expect(coded(found, "courtyard-overlap")).toEqual([])
      expect(coded(found, "silk-on-pad")).toEqual([
        expect.objectContaining({ id: "silk-on-pad:R2#1,U1", severity: "warning", items: ["R2#1", "U1"], at: { x: 3, y: 1.3 } }),
      ])
      expect(coded(found, "silk-on-pad")[0]?.message).toBe("Silkscreen of U1 is on R2#1; the minimum is 0.150 mm")
    })

    test("a neighbour's pad on the other side is ignored, its through pad is not", () => {
      expect(coded(partChecks(across({ layers: "bottom" }), RULES), "silk-on-pad")).toEqual([])
      expect(coded(partChecks(across({ layers: "through" }), RULES), "silk-on-pad").map((v) => v.items)).toEqual([["R2#1", "U1"]])
    })
  })
})

describe("unplaced, unrouted and unchecked", () => {
  test("auto-placed parts give one unplaced warning listing them, and no auto-placed diagnostic", () => {
    const built = design(`<resistor name="R2" footprint="0603" />\n<resistor name="R1" footprint="0603" />`)
    const found = coded(run(built), "unplaced")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["R1", "R2"] })
    expect(found[0]?.at).toEqual({ x: built.pcb.parts.find((p) => p.component === "R1")?.x, y: built.pcb.parts.find((p) => p.component === "R1")?.y })
    expect(built.diagnostics.filter((d) => d.code === "auto-placed")).toEqual([])
  })

  test("placed parts give no unplaced warning", () => {
    expect(coded(run(design(resistor("R1", 0))), "unplaced")).toEqual([])
  })

  test("unrouted counts the ratsnest lines in one warning", async () => {
    const built = buildDesign(await collectProjectFiles(EXAMPLE, { include: ENGINE_FILES }), "index.circuit.tsx")
    const found = coded(run(built), "unrouted")
    expect(built.pcb.ratsnest.length).toBeGreaterThan(0)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: [], message: `${built.pcb.ratsnest.length} connections are not routed yet` })
  })

  test("no ratsnest, no unrouted warning", () => {
    expect(coded(partChecks(layoutOf([part("A")], SQUARE), RULES), "unrouted")).toEqual([])
  })

  test("no board gives the unchecked warning and no outside-board", () => {
    const found = run(design(resistor("R1", 15), false))
    expect(coded(found, "unchecked")).toEqual([
      expect.objectContaining({ severity: "warning", message: "no board outline: edge and outside-board checks were not run" }),
    ])
    expect(coded(found, "outside-board")).toEqual([])
  })

  test("an outline with two points is unusable: unchecked, and no outside-board", () => {
    const line = board([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    const found = partChecks(layoutOf([part("A", { courtyard: rectangle(50, 50, 51, 51) })], line), RULES)
    expect(coded(found, "unchecked")).toHaveLength(1)
    expect(coded(found, "outside-board")).toEqual([])
  })

  test("a usable outline gives no unchecked warning", () => {
    expect(coded(partChecks(layoutOf([part("A")], SQUARE), RULES), "unchecked")).toEqual([])
  })
})
