import { describe, expect, test } from "vitest"
import { flipPlan, PAGE_GAP_MM, transferPlan, TRANSFER_SCALE } from "../studio/src/shell/board-side.js"
import { findSimilar } from "../studio/src/shell/find-similar.js"
import { keyAction } from "../studio/src/pcb/canvas-keys.js"

import type { PartInfo } from "../src/core/types.js"

const prop = (literal: number) => ({ literal, source: `{${literal}}`, editable: true })
const parts: Pick<PartInfo, "name" | "editable" | "props">[] = [
  { name: "R1", editable: true, props: { pcbX: prop(1), pcbY: prop(2) } },
  { name: "R2", editable: true, props: {} },
  { name: "C1", editable: true, props: {} },
]
const board = [
  { component: "R1", x: 1, y: 2, side: "top" as const },
  { component: "R2", x: 5.12345, y: -3, side: "bottom" as const },
  { component: "C1", x: 0, y: 0, side: "top" as const },
]

describe("Layout → Flip", () => {
  test("puts each part on the other side, writing a position for a part that had none, as one edit list", () => {
    const plan = flipPlan(["R1", "R2"], board, parts, new Set())
    expect(plan).toEqual({
      edits: [
        { kind: "setProps", part: "R1", props: { layer: "bottom" } },
        { kind: "setProps", part: "R2", props: { layer: "top", pcbX: 5.123, pcbY: -3 } },
      ],
      summary: "flip R1, R2",
      skipped: [],
    })
    expect(flipPlan(["R1"], board, parts, new Set())).toMatchObject({ summary: "flip R1 to the bottom" })
  })

  test("leaves locked parts and says so; refuses with nothing it may flip", () => {
    expect(flipPlan(["R1", "C1"], board, parts, new Set(["C1"]))).toMatchObject({ summary: "flip R1 to the bottom; left C1 (locked)", skipped: ["C1 (locked)"] })
    expect(flipPlan(["C1"], board, parts, new Set(["C1"]))).toEqual({ message: "Cannot flip C1 (locked)." })
    // A part a sub-sheet instance brings in is on the board but not in this file.
    expect(flipPlan(["S1_R1"], [...board, { component: "S1_R1", x: 0, y: 0, side: "top" }], parts, new Set())).toEqual({ message: "Cannot flip S1_R1 (inside a sub-sheet; change it in its sheet)." })
    expect(flipPlan([], board, parts, new Set())).toEqual({ message: "Select a part on the PCB to flip." })
  })

  test("X is Flip on the PCB only", () => {
    const x = { key: "x", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false }
    expect(keyAction(x, { view: "pcb" })?.action).toBe("flip")
    expect(keyAction(x, { view: "schematic" })).toBeNull()
  })
})

describe("Design → Placement transfer", () => {
  test("places the parts as their symbols sit, scaled, about the middle of where they are", () => {
    const sheet = [
      { component: "R1", x: 0, y: 0 },
      { component: "C1", x: 2, y: 1 },
    ]
    const plan = transferPlan(["R1", "C1"], sheet, board, parts, new Set())
    // Board middle (0.5, 1), sheet middle (1, 0.5).
    expect(plan).toEqual({
      edits: [
        { kind: "setProps", part: "R1", props: { pcbX: 0.5 - TRANSFER_SCALE, pcbY: 1 - 0.5 * TRANSFER_SCALE } },
        { kind: "setProps", part: "C1", props: { pcbX: 0.5 + TRANSFER_SCALE, pcbY: 1 + 0.5 * TRANSFER_SCALE } },
      ],
      summary: "place 2 parts as on the schematic",
      skipped: [],
    })
  })

  test("two pages land in their own regions side by side, and each part takes its symbol's rotation", () => {
    // Both pages draw their part at the same sheet spot; on one sheet they would land on each other.
    const sheet = [
      { component: "R1", x: 0, y: 0, page: 0, rotation: 90 },
      { component: "C1", x: 0, y: 0, page: 1, rotation: 0 },
    ]
    const plan = transferPlan(["R1", "C1"], sheet, board, parts, new Set())
    if ("message" in plan) throw new Error(plan.message)
    const [r1, c1] = plan.edits.map((edit) => (edit.kind === "setProps" ? edit.props : {}))
    expect(r1).toMatchObject({ pcbRotation: 90 })
    expect(c1).toMatchObject({ pcbRotation: 0 })
    expect(Math.abs((c1?.["pcbX"] as number) - (r1?.["pcbX"] as number))).toBeGreaterThanOrEqual(PAGE_GAP_MM)
    expect(c1?.["pcbX"]).toBeGreaterThan(r1?.["pcbX"] as number)
  })

  test("leaves locked parts in place and refuses when no part is on both views", () => {
    const sheet = [{ component: "R1", x: 0, y: 0 }, { component: "C1", x: 1, y: 0 }]
    expect(transferPlan(["R1", "C1"], sheet, board, parts, new Set(["R1"]))).toMatchObject({ skipped: ["R1 (locked)"], summary: "place C1 as on the schematic; left R1 (locked)" })
    expect(transferPlan(["X9"], sheet, board, parts, new Set())).toHaveProperty("message")
  })
})

describe("Edit → Find similar objects", () => {
  const all = [
    { id: "R1", kind: "resistor", value: "10k", footprint: "0402" },
    { id: "R2", kind: "resistor", value: "10k", footprint: "0402" },
    { id: "R3", kind: "resistor", value: "1k", footprint: "0402" },
    { id: "C1", kind: "capacitor", value: "10k", footprint: "0402" },
  ]
  test("selects the parts of the same kind, footprint and value", () => {
    expect(findSimilar({ parts: ["R2"], drawings: [] }, all, [])).toEqual({ parts: ["R1", "R2"], drawings: [], note: "Selected 2 parts like R2 (resistor, 10k, 0402)" })
  })
  test("with a drawing selected, the drawings of its kind; with nothing, says why", () => {
    const drawings = [{ id: "a", kind: "rect" }, { id: "b", kind: "text" }, { id: "c", kind: "rect" }]
    expect(findSimilar({ parts: [], drawings: ["c"] }, all, drawings)).toEqual({ parts: [], drawings: ["a", "c"], note: "Selected 2 rect drawings" })
    expect(findSimilar({ parts: [], drawings: [] }, all, drawings)).toHaveProperty("message")
  })
})
