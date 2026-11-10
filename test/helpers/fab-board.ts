// Small hand-made boards for the fabrication tests: pads, parts, vias and a 20 x 10 mm board around the origin.
import type { PcbLayout, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"

export const OUTLINE = [
  { x: -10, y: -5 },
  { x: 10, y: -5 },
  { x: 10, y: 5 },
  { x: -10, y: 5 },
]

export const pad = (number: string, fields: Partial<WorldPad> = {}): WorldPad => ({
  number,
  shape: "rect",
  x: 0,
  y: 0,
  width: 1,
  height: 0.6,
  rotation: 0,
  layers: "top",
  id: `P1#${number}`,
  component: "P1",
  ...fields,
})

/** A through pad of `size` with a round hole of `drill`, or a slot when `drill` gives width and height. */
export const throughPad = (number: string, x: number, y: number, drill: number | { width: number; height: number }, fields: Partial<WorldPad> = {}): WorldPad => {
  const hole = typeof drill === "number" ? { width: drill, height: drill } : drill
  return pad(number, { x, y, shape: "circle", width: hole.width + 0.6, height: hole.height + 0.6, layers: "through", drill: hole, ...fields })
}

export const part = (pads: WorldPad[], fields: Partial<PlacedFootprint> = {}): PlacedFootprint => ({
  component: "P1",
  x: 0,
  y: 0,
  rotation: 0,
  side: "top",
  autoPlaced: false,
  pads,
  courtyard: [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ],
  silkscreen: [],
  fabrication: [],
  ...fields,
})

export const via = (x: number, y: number, drill = 0.3): PcbVia => ({ id: "v0001", at: { x, y }, drill, diameter: drill + 0.3, layers: ["top", "bottom"], locked: false, by: "human" })

export const board = (fields: Partial<PcbLayout>, layers: 2 | 4 = 2): PcbLayout => ({
  board: { outline: OUTLINE, layers, thickness: 1.6, keepouts: [] },
  parts: [],
  tracks: [],
  vias: [],
  ratsnest: [],
  pours: [],
  holes: [],
  ...fields,
})
