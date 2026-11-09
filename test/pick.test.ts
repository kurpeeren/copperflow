import { describe, expect, test } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { boxSelection } from "../studio/src/pcb/box-select.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import { targetAt } from "../studio/src/pcb/gestures.js"
import { DEFAULT_LAYERS, type PickLayers } from "../studio/src/pcb/layers.js"
import { ALL_PICKABLE, filterRows, kindPickable, togglePickKind } from "../studio/src/pcb/pick-filter.js"
import { canPick, pickNames, picks, selectAll, type PickContext } from "../studio/src/pcb/pick.js"
import { Selection } from "../studio/src/selection.js"

const label = { id: "label:VCC", text: "VCC", net: "VCC", at: { x: 9, y: 0 } } as unknown as NetLabel
const partBox = (name: string, minX: number, maxX: number): PartBox => ({ name, pcbComponentId: name, center: { x: (minX + maxX) / 2, y: 0 }, box: { minX, minY: -1, maxX, maxY: 1 } })
// C1 sits inside R1's box, so a press on C1 hits both.
const BOXES = [partBox("R1", 0, 4), partBox("C1", 1, 2)]
const labels = { at: (world: { x: number }) => (world.x > 8 ? label : undefined), blocker: () => null, commit: () => undefined }

const free: PickContext = { selection: Selection.none, armed: null }
const note: PickContext = { selection: Selection.none, armed: "note" }

describe("canPick", () => {
  test("every part and net label may be picked with no tool or a Place tool armed", () => {
    for (const armed of [null, "place"] as const) {
      expect(canPick({ kind: "part", name: "R1" }, { ...free, armed })).toBe(true)
      expect(canPick({ kind: "label", label }, { ...free, armed })).toBe(true)
    }
  })

  test("with the Note box tool armed nothing is picked: a press draws the note box", () => {
    expect(canPick({ kind: "part", name: "R1" }, note)).toBe(false)
    expect(canPick({ kind: "label", label }, note)).toBe(false)
  })

  test("picks and pickNames keep the order of what they are given", () => {
    expect(picks([{ kind: "part", name: "C1" }, { kind: "label", label }], free)).toEqual([{ kind: "part", name: "C1" }, { kind: "label", label }])
    expect(pickNames(["R2", "R1"], free)).toEqual(["R2", "R1"])
    expect(pickNames(["R2", "R1"], note)).toEqual([])
  })
})

describe("every pick goes through canPick", () => {
  test("the target under the pointer: the smallest part, else a label, else the canvas", () => {
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, free)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, labels, { x: 3, y: 0 }, free)).toEqual({ kind: "part", name: "R1" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, free)).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, note)).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, note)).toEqual({ kind: "canvas" })
  })

  test("the parts a box takes", () => {
    const before = Selection.none.add(["U1"])
    expect(boxSelection(["R1", "C1"], false)(before).names).toEqual(["R1", "C1"])
    expect(boxSelection(["R1", "C1"], false, "note")(before)).toBe(Selection.none)
    expect(boxSelection(["R1", "C1"], true, "note")(before)).toBe(before)
  })

  test("Select all takes every part of the circuit, each once, and keeps the selection when it already is that", () => {
    const all = selectAll(["R1", "C1", "R1"])(Selection.none)
    expect(all.names).toEqual(["R1", "C1"])
    expect(selectAll(["R1", "C1"])(all)).toBe(all)
  })
})

describe("hidden layers", () => {
  const visible = { ...DEFAULT_LAYERS, top: false, topAssembly: false }
  const layers: PickLayers = { visible, of: (part) => (part === "R1" ? ["top", "topAssembly"] : ["top", "multiLayer"]) }
  const hiding: PickContext = { ...free, layers }

  test("a part whose drawn layers are all hidden cannot be picked; one with a shown layer can", () => {
    expect(canPick({ kind: "part", name: "R1" }, hiding)).toBe(false)
    expect(canPick({ kind: "part", name: "C1" }, hiding)).toBe(true)
    expect(canPick({ kind: "label", label }, hiding)).toBe(true)
  })

  test("Select all leaves out the parts that are only on hidden layers", () => {
    expect(selectAll(["R1", "C1"], layers)(Selection.none).names).toEqual(["C1"])
    expect(selectAll(["R1", "C1"])(Selection.none).names).toEqual(["R1", "C1"])
  })

  test("a click goes through to the shown part under it, and a box takes only the shown parts", () => {
    expect(targetAt(BOXES, undefined, { x: 3, y: 0 }, hiding)).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, undefined, { x: 1.5, y: 0 }, hiding)).toEqual({ kind: "part", name: "C1" })
    expect(boxSelection(["R1", "C1"], false, null, layers)(Selection.none).names).toEqual(["C1"])
    expect(pickNames(["R1", "C1"], hiding)).toEqual(["C1"])
  })
})

describe("the Filter tab", () => {
  const noParts = { parts: false, labels: true }
  const noLabels = { parts: true, labels: false }

  test("a kind switched off cannot be picked; the other can", () => {
    expect(canPick({ kind: "part", name: "R1" }, { ...free, filter: noParts })).toBe(false)
    expect(canPick({ kind: "label", label }, { ...free, filter: noParts })).toBe(true)
    expect(canPick({ kind: "part", name: "R1" }, { ...free, filter: noLabels })).toBe(true)
    expect(canPick({ kind: "label", label }, { ...free, filter: noLabels })).toBe(false)
  })

  test("a click goes through the part under it to a label, or to the canvas", () => {
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, { ...free, filter: noParts })).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, { ...free, filter: noLabels })).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, { ...free, filter: noParts })).toEqual({ kind: "label", label })
    // A label over a part (the sheet hover asks the same): the part while Parts is on, else the label.
    const everywhere = { ...labels, at: () => label }
    expect(targetAt(BOXES, everywhere, { x: 1.5, y: 0 }, free)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, everywhere, { x: 1.5, y: 0 }, { ...free, filter: noParts })).toEqual({ kind: "label", label })
  })

  test("a box takes no parts while Parts is off, and keeps the selection when it adds", () => {
    const before = Selection.none.add(["U1"])
    expect(boxSelection(["R1", "C1"], false, null, undefined, noParts)(before)).toBe(Selection.none)
    expect(boxSelection(["R1", "C1"], true, null, undefined, noParts)(before)).toBe(before)
    expect(boxSelection(["R1", "C1"], false, null, undefined, noLabels)(before).names).toEqual(["R1", "C1"])
  })

  test("Select all takes no parts while Parts is off", () => {
    expect(selectAll(["R1", "C1"], undefined, noParts)(Selection.none)).toBe(Selection.none)
    expect(selectAll(["R1", "C1"], undefined, noLabels)(Selection.none).names).toEqual(["R1", "C1"])
  })

  test("it combines with hidden layers", () => {
    const layers: PickLayers = { visible: { ...DEFAULT_LAYERS }, of: () => undefined }
    expect(canPick({ kind: "part", name: "R1" }, { ...free, layers, filter: noParts })).toBe(false)
  })

  test("toggling gives a new filter, the rows follow the view, and a missing filter allows everything", () => {
    expect(ALL_PICKABLE).toEqual({ parts: true, labels: true })
    const off = togglePickKind(ALL_PICKABLE, "labels")
    expect(off).toEqual({ parts: true, labels: false })
    expect(ALL_PICKABLE.labels).toBe(true)
    expect(togglePickKind(off, "labels")).toEqual(ALL_PICKABLE)
    expect(kindPickable(undefined, "parts")).toBe(true)
    expect(filterRows("pcb").map((row) => row.label)).toEqual(["Parts"])
    expect(filterRows("schematic").map((row) => row.label)).toEqual(["Parts", "Net labels and flags"])
  })
})
