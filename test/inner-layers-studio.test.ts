// A 4-layer board's inner copper in the Layer panel: two more rows with eyes, and the tracks, pours and drawings on
// them follow those eyes. A 2-layer board's panel does not change.
import { describe, expect, test } from "vitest"
import { copperShown } from "../studio/src/pcb/copper-hit.js"
import { graphicShown } from "../studio/src/pcb/graphic-draw.js"
import { copperLayerShown, DEFAULT_LAYERS, layerRows, toggleLayer } from "../studio/src/pcb/layers.js"
import { pourShown } from "../studio/src/pcb/pour-hit.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import type { BoardGraphic } from "../src/engine/model.js"

const NONE: ReadonlySet<string> = new Set()
const graphic = (layer: string) => ({ id: "boardgraphic:1", layer }) as unknown as BoardGraphic

describe("the Layer panel's rows", () => {
  test("a 2-layer board lists the same rows as before", () => {
    expect(layerRows(true, "all", 2).map((row) => row.id)).toEqual(layerRows(true, "all").map((row) => row.id))
    expect(layerRows(true, "all", 2).some((row) => row.id === "inner1" || row.id === "inner2")).toBe(false)
    expect(layerRows(true, "copper", 2).map((row) => row.name)).toEqual(["Top Layer", "Bottom Layer", "Multi-Layer"])
  })

  test("a 4-layer board lists its inner layers between the top and bottom copper, in their own colours", () => {
    expect(layerRows(false, "copper", 4).map((row) => row.name)).toEqual(["Top Layer", "Inner Layer 1", "Inner Layer 2", "Bottom Layer", "Multi-Layer"])
    expect(layerRows(false, "all", 4).find((row) => row.id === "inner1")).toMatchObject({ group: "copper", color: PALETTE.inner1Copper })
    expect(layerRows(false, "non-copper", 4).some((row) => row.group === "copper")).toBe(false)
  })

  test("the inner layers are shown at first and switch like the others", () => {
    expect(DEFAULT_LAYERS.inner1).toBe(true)
    expect(DEFAULT_LAYERS.inner2).toBe(true)
    expect(toggleLayer(DEFAULT_LAYERS, "inner2").inner2).toBe(false)
  })
})

describe("what an inner layer's switch hides", () => {
  const hidden = toggleLayer(DEFAULT_LAYERS, "inner1")

  test("copper layers by name", () => {
    expect(copperLayerShown("inner1", DEFAULT_LAYERS)).toBe(true)
    expect(copperLayerShown("inner1", hidden)).toBe(false)
    expect(copperLayerShown("inner2", hidden)).toBe(true)
    expect(copperLayerShown("top", { ...DEFAULT_LAYERS, top: false })).toBe(false)
    expect(copperLayerShown("top-silkscreen", DEFAULT_LAYERS)).toBe(false)
  })

  test("its tracks", () => {
    expect(copperShown({ kind: "track", layer: "inner1" }, DEFAULT_LAYERS)).toBe(true)
    expect(copperShown({ kind: "track", layer: "inner1" }, hidden)).toBe(false)
    expect(copperShown({ kind: "track", layer: "inner2" }, hidden)).toBe(true)
  })

  test("its pours, which also keep their own eyes", () => {
    const pour = { id: "copperpour:3", layer: "inner1" }
    expect(pourShown(pour, DEFAULT_LAYERS, NONE)).toBe(true)
    expect(pourShown(pour, hidden, NONE)).toBe(false)
    expect(pourShown(pour, DEFAULT_LAYERS, new Set(["copperpour:3"]))).toBe(false)
  })

  test("its drawings", () => {
    expect(graphicShown(DEFAULT_LAYERS, graphic("inner1"))).toBe(true)
    expect(graphicShown(hidden, graphic("inner1"))).toBe(false)
    expect(graphicShown(hidden, graphic("inner2"))).toBe(true)
    expect(graphicShown(hidden, graphic("top"))).toBe(true)
  })
})
