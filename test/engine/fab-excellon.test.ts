import { describe, expect, test } from "vitest"
import { drillFiles } from "../../src/engine/fab/excellon.js"
import { VERSION } from "../../src/version.js"
import { readDrill, type ReadDrill } from "../helpers/drill-read.js"
import { board, pad, part, throughPad, via } from "../helpers/fab-board.js"

const CREATED = new Date(Date.UTC(2026, 10, 10, 9, 5, 7))

function read(pcb: Parameters<typeof drillFiles>[0]): Map<string, { text: string; drill: ReadDrill }> {
  return new Map(drillFiles(pcb, "b", CREATED).map(({ file, text }) => [file, { text, drill: readDrill(text) }]))
}

const holesByTool = (drill: ReadDrill) =>
  [...drill.tools].map(([code, diameter]) => ({ diameter, holes: drill.holes.filter((h) => h.tool === code).length, slots: drill.slots.filter((s) => s.tool === code).length }))

describe("the Excellon drill files", () => {
  test("the plated file holds the through pads and the vias, one tool per diameter from the smallest, in metric", () => {
    const pads = [throughPad("1", -3, 0, 1), throughPad("2", -0.46, 0, 1), throughPad("3", 2, 1.5, 0.8), pad("4", { x: 4 })]
    const files = read(board({ parts: [part(pads)], vias: [via(1, -2), via(5, -2), via(6, 2.5, 0.4)] }))
    expect([...files.keys()]).toEqual(["b-PTH.drl", "b-NPTH.drl"])
    const plated = files.get("b-PTH.drl")
    expect(plated?.drill.units).toBe("mm")
    expect(plated?.text).toMatch(/^M48\n/)
    expect(plated?.text).toContain("\nFMAT,2\nMETRIC\n")
    expect(plated?.text).not.toContain("\r")
    expect(plated?.text.endsWith("M30\n")).toBe(true)
    expect(plated?.drill.comments).toEqual(
      expect.arrayContaining([
        `#@! TF.GenerationSoftware,copperflow,copperflow,${VERSION}`,
        "#@! TF.CreationDate,2026-11-10T09:05:07+00:00",
        "#@! TF.FileFunction,Plated,1,2,PTH",
      ]),
    )
    expect(holesByTool(plated?.drill as ReadDrill)).toEqual([
      { diameter: 0.3, holes: 2, slots: 0 },
      { diameter: 0.4, holes: 1, slots: 0 },
      { diameter: 0.8, holes: 1, slots: 0 },
      { diameter: 1, holes: 2, slots: 0 },
    ])
    const tool1 = [...(plated?.drill.tools.keys() ?? [])][3]
    expect(plated?.drill.holes.filter((h) => h.tool === tool1).map((h) => h.at)).toEqual([
      { x: -3, y: 0 },
      { x: -0.46, y: 0 },
    ])
    expect(plated?.text).toContain("#@! TA.AperFunction,Plated,PTH,ViaDrill\nT1C0.300\n")
    expect(plated?.text).toContain("#@! TA.AperFunction,Plated,PTH,ComponentDrill\nT4C1.000\n")
  })

  test("the non-plated file is written with no tools when the board has no unplated holes", () => {
    const npth = read(board({ parts: [part([throughPad("1", 0, 0, 1)])] })).get("b-NPTH.drl")
    expect(npth?.drill.comments).toContain("#@! TF.FileFunction,NonPlated,1,2,NPTH")
    expect(npth?.drill.tools.size).toBe(0)
    expect(npth?.drill.holes).toEqual([])
  })

  test("a slot is a G85 route with the slot's width as its tool, along its long side, turned with the pad", () => {
    const pads = [throughPad("1", 2, 1, { width: 2, height: 0.8 }), throughPad("2", -2, 0, { width: 0.8, height: 2 }), throughPad("3", 0, -3, { width: 2, height: 0.8 }, { rotation: 90 })]
    const plated = read(board({ parts: [part(pads)] })).get("b-PTH.drl")?.drill as ReadDrill
    expect([...plated.tools.values()]).toEqual([0.8])
    expect(plated.holes).toEqual([])
    expect(plated.slots.map(({ from, to }) => [from, to])).toEqual([
      [
        { x: 1.4, y: 1 },
        { x: 2.6, y: 1 },
      ],
      [
        { x: -2, y: -0.6 },
        { x: -2, y: 0.6 },
      ],
      [
        { x: 0, y: -3.6 },
        { x: 0, y: -2.4 },
      ],
    ])
  })

  test("vias with a layer the board lacks are left out, and a 4-layer board's plated file spans layers 1 to 4", () => {
    const missing = { ...via(0, 0), layers: ["top", "inner1" as const, "bottom" as const] as ("top" | "inner1" | "bottom")[], missingLayer: "inner1" as const }
    expect(read(board({ vias: [missing] })).get("b-PTH.drl")?.drill.holes).toEqual([])
    const four = read(board({ vias: [via(0, 0)] }, 4)).get("b-PTH.drl")
    expect(four?.drill.comments).toContain("#@! TF.FileFunction,Plated,1,4,PTH")
  })

  test("a second run writes the same bytes", () => {
    const pcb = board({ parts: [part([throughPad("1", 0, 0, 1), throughPad("2", 3, 0, { width: 2, height: 1 })])], vias: [via(1, 1)] })
    expect(drillFiles(pcb, "b", CREATED)).toEqual(drillFiles(structuredClone(pcb), "b", CREATED))
  })
})
