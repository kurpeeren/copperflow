// A large drawing on a net among many items of its net: what it joins is found with boxes first and each item's
// outline built once, so a drawing of thousands of pieces beside hundreds of tracks resolves in well under a second.
import { describe, expect, test } from "vitest"
import { netDrawingFills } from "../../src/engine/drawing-copper.js"
import type { PcbTrack } from "../../src/engine/copper.js"
import type { BoardGraphic, Point } from "../../src/engine/model.js"
import { pourInputKey } from "../../src/engine/pour/cache.js"
import { pourJoins } from "../../src/engine/pour/joins.js"
import { loadRules } from "../../src/engine/rules/load.js"

const SIDE = 50
const square = (x: number, y: number, size: number): Point[] => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }]
const graphic = (net: string | undefined): BoardGraphic => ({
  id: "boardgraphic:1",
  file: "graphics/grid.svg",
  layer: "top",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: true,
  ...(net === undefined ? {} : { net }),
  areas: Array.from({ length: SIDE * SIDE }, (_, i) => ({ outer: square((i % SIDE) * 2, Math.floor(i / SIDE) * 2, 1), holes: [] })),
  lines: [],
  skipped: [],
  source: { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 },
})

describe("a drawing of 2,500 pieces on GND beside 500 GND tracks", () => {
  test("its joins are found in under 3 s (box tests first, outlines once per item)", () => {
    const tracks: PcbTrack[] = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, net: "net.GND", layer: "top", width: 0.2, points: [{ x: (i % 50) * 2 + 0.5, y: Math.floor(i / 50) * 2 + 0.5 }, { x: (i % 50) * 2 + 0.6, y: Math.floor(i / 50) * 2 + 0.5 }], pads: [] }) as unknown as PcbTrack)
    const fills = netDrawingFills([graphic("net.GND")])
    expect(fills[0]?.polygons.length).toBe(SIDE * SIDE)
    const started = performance.now()
    const joins = pourJoins(fills, [], tracks, [])
    const ms = performance.now() - started
    process.stdout.write(`pourJoins over ${SIDE * SIDE} pieces and 500 tracks: ${ms.toFixed(0)} ms\n`)
    expect(joins.filter((ids) => ids.length > 0)).toHaveLength(500)
    expect(ms).toBeLessThan(3000)
  })
})

test("the pour cache key holds the class of a net only a drawing carries", () => {
  const board = { outline: square(-5, -5, 10), layers: 2 as const, thickness: 1.6, keepouts: [], pours: [], graphics: [graphic("net.ONLY")] }
  const inputs = (cls: string) => ({ board, pads: [], tracks: [], vias: [], rules: loadRules({}).rules, classOf: (net: string | undefined) => (net === "net.ONLY" ? cls : "default") })
  expect(pourInputKey(inputs("power") as never)).not.toBe(pourInputKey(inputs("default") as never))
})
