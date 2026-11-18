import { describe, expect, test } from "vitest"
import { pickAndPlaceCsv } from "../../src/engine/fab/pick-and-place.js"
import type { Footprint } from "../../src/engine/footprints/types.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { PROFILES } from "../../src/engine/rules/profiles.js"
import { footprintFamily, PLACEMENT_ROTATIONS, placementCorrection } from "../../src/engine/rules/rotations.js"
import type { FabricationProfile } from "../../src/engine/rules/schema.js"
import { board, pad, part } from "../helpers/fab-board.js"

const PROFILE = PROFILES["jlcpcb-2layer"] as FabricationProfile
const footprint = (name: string): Footprint => ({ name, pads: [], courtyard: [], silkscreen: [], fabrication: [], origin: "test" })

const rows = (csv: string) => csv.trimEnd().split("\n")

describe("the footprint families' rotation corrections", () => {
  test("SOIC, SOP and TSSOP turn 270 and SOT-23 180 by default, as JLCPCB's part models need; chips, pin rows and footprint files 0", () => {
    expect(footprintFamily("0805")).toBe("chip")
    expect(footprintFamily("sod123")).toBe("sod")
    expect(footprintFamily("sot23_5")).toBe("sot")
    expect(footprintFamily("soic8")).toBe("soic")
    expect(footprintFamily("tssop20")).toBe("tssop")
    expect(footprintFamily("qfn32_ep")).toBe("qfn")
    expect(footprintFamily("pinrow2_p4.88mm")).toBe("pinrow")
    expect(footprintFamily("parts/MCP2515/footprint.yaml")).toBe("file")
    const nonZero = Object.fromEntries(Object.entries(PLACEMENT_ROTATIONS).filter(([, degrees]) => degrees !== 0))
    expect(nonZero).toEqual({ sot: 180, sot223: 180, soic: 270, sop: 270, ssop: 270, tssop: 270, msop: 270, qsop: 270 })
    expect(placementCorrection("soic8", PROFILE)).toBe(270)
    expect(placementCorrection("soic18w", PROFILE)).toBe(270)
    expect(placementCorrection("ssop20", PROFILE)).toBe(270)
    expect(placementCorrection("sot23_5", PROFILE)).toBe(180)
    expect(placementCorrection("0805", PROFILE)).toBe(0)
    expect(placementCorrection("pinrow2_p2.54mm", PROFILE)).toBe(0)
    expect(placementCorrection("parts/MCP2515/footprint.yaml", PROFILE)).toBe(0)
  })

  test("rules.yaml sets a family's correction; an unknown family or a value that is not a number is a rules error", () => {
    const set = loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    soic: 270\n    chip: -90\n" })
    expect(set.diagnostics).toEqual([])
    expect(placementCorrection("soic8", set.rules.fabrication)).toBe(270)
    expect(placementCorrection("0603", set.rules.fabrication)).toBe(-90)
    expect(placementCorrection("sot23", set.rules.fabrication)).toBe(180)
    expect(loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    to3: 90\n" }).diagnostics[0]?.message).toMatch(/placementRotations/)
    expect(loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    soic: left\n" }).diagnostics[0]?.message).toMatch(/placementRotations\.soic/)
  })

  test("every generated family has its own entry: SOT-223 180, MSOP and QSOP 270, SOT-89 and the rest 0", () => {
    const cases: [string, string, number][] = [
      ["sot223", "sot223", 180],
      ["sot89", "sot89", 0],
      ["qfn32_5x5_p0.5_ep3.1", "qfn", 0],
      ["dfn8_3x3_p0.65", "dfn", 0],
      ["lqfp64_10x10_p0.5", "lqfp", 0],
      ["tqfp32", "tqfp", 0],
      ["bga256_17x17_p1", "bga", 0],
      ["sma", "sma", 0],
      ["smc", "smc", 0],
      ["do214ac", "do214ac", 0],
      ["do214ab", "do214ab", 0],
      ["dip8", "dip", 0],
      ["to220", "to220", 0],
      ["to92", "to92", 0],
      ["hc49", "hc49", 0],
      ["hc49s", "hc49s", 0],
      ["radial6.3x2.5", "radial", 0],
      ["pinrow2x5", "pinrow2x", 0],
      ["pinrow5", "pinrow", 0],
      ["msop8", "msop", 270],
      ["qsop16", "qsop", 270],
      ["sot323", "sot", 180],
      ["minimelf", "sod", 0],
      ["to247", "to247", 0],
      ["d2pak", "d2pak", 0],
      ["xtal3225", "xtal", 0],
    ]
    for (const [text, family, degrees] of cases) {
      expect(footprintFamily(text), text).toBe(family)
      expect(placementCorrection(text, PROFILE), text).toBe(degrees)
    }
  })

  test("rules.yaml overrides a generated family, such as dfn", () => {
    const set = loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    dfn: 270\n    sot89: 90\n    pinrow2x: 180\n" })
    expect(set.diagnostics).toEqual([])
    expect(placementCorrection("dfn8_3x3_p0.65_ep1.6x2.4", set.rules.fabrication)).toBe(270)
    expect(placementCorrection("sot89", set.rules.fabrication)).toBe(90)
    expect(placementCorrection("pinrow2x5", set.rules.fabrication)).toBe(180)
    expect(placementCorrection("qfn32_ep", set.rules.fabrication)).toBe(0)
    expect(placementCorrection("sot223", set.rules.fabrication)).toBe(180)
  })

  test("a footprint file's part id in placementRotations.parts overrides its family's correction for that part only", () => {
    const set = loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    file: 90\n    parts:\n      MCP2515: 180\n" })
    expect(set.diagnostics).toEqual([])
    expect(placementCorrection("parts/MCP2515/footprint.yaml", set.rules.fabrication)).toBe(180)
    expect(placementCorrection("parts/TJA1050/footprint.yaml", set.rules.fabrication)).toBe(90)
    expect(placementCorrection("soic8", set.rules.fabrication)).toBe(270)
    expect(loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    parts:\n      MCP2515: up\n" }).diagnostics[0]?.message).toMatch(/placementRotations\.parts\.MCP2515/)
    expect(loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    parts:\n      ../x: 90\n" }).diagnostics[0]?.message).toMatch(/placementRotations\.parts/)
  })
})

describe("the pick-and-place file", () => {
  test("lists every part with a footprint in JLCPCB's columns, in designator order, positions in mm", () => {
    const parts = [
      part([pad("1")], { component: "R10", x: 1.25, y: -2.5, rotation: 90, footprint: footprint("0805") }),
      part([pad("1")], { component: "R2", x: -3, y: 4, rotation: 0, footprint: footprint("0805") }),
      part([], { component: "X1", x: 0, y: 0 }),
    ]
    expect(rows(pickAndPlaceCsv(board({ parts }), PROFILE))).toEqual(["Designator,Mid X,Mid Y,Layer,Rotation", "R2,-3mm,4mm,Top,0", "R10,1.25mm,-2.5mm,Top,90"])
  })

  test("a bottom part keeps its X as seen from the top and its rotation, with the family's correction added; the top one too", () => {
    const fabrication = loadRules({ "rules.yaml": "fabrication:\n  placementRotations:\n    soic: 270\n" }).rules.fabrication
    const top = part([pad("1", { x: 7.5, y: 1 })], { component: "U1", x: 7.5, y: 1, rotation: 90, footprint: footprint("soic8") })
    // Placed at x = 7.5 on the bottom, its pads mirrored about it: JLCPCB reads the bottom from the top, not mirrored again.
    const bottom = part([pad("1", { x: 7.5 - 2.7, y: -3, layers: "bottom" })], { component: "U2", x: 7.5, y: -3, rotation: 30, side: "bottom", footprint: footprint("soic8") })
    expect(rows(pickAndPlaceCsv(board({ parts: [top, bottom] }), fabrication)).slice(1)).toEqual(["U1,7.5mm,1mm,Top,0", "U2,7.5mm,-3mm,Bottom,300"])
  })

  test("rotations stay in 0 to 360 and coordinates never read -0", () => {
    const parts = [part([], { component: "C1", x: -0.00000001, y: 0, rotation: -90, footprint: footprint("0603") })]
    expect(rows(pickAndPlaceCsv(board({ parts }), PROFILE))[1]).toBe("C1,0mm,0mm,Top,270")
  })
})
