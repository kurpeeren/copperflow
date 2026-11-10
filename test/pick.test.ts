import { describe, expect, test } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { boxSelection } from "../studio/src/pcb/box-select.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import { targetAt } from "../studio/src/pcb/gestures.js"
import { DEFAULT_LAYERS, type PickLayers } from "../studio/src/pcb/layers.js"
import { ALL_PICKABLE, pickKindRows, kindPickable, togglePickKind } from "../studio/src/pcb/pick-filter.js"
import { canPick, pickNames, picks, selectAll, type PickContext } from "../studio/src/pcb/pick.js"
import { Selection } from "../studio/src/selection.js"

const label = { id: "label:VCC", text: "VCC", net: "VCC", at: { x: 9, y: 0 } } as unknown as NetLabel
const partBox = (name: string, minX: number, maxX: number): PartBox => ({ name, pcbComponentId: name, center: { x: (minX + maxX) / 2, y: 0 }, box: { minX, minY: -1, maxX, maxY: 1 } })
// C1 sits inside R1's box, so a press on C1 hits both.
const BOXES = [partBox("R1", 0, 4), partBox("C1", 1, 2)]
const labels = { at: (world: { x: number }) => (world.x > 8 ? label : undefined), blocker: () => null, commit: () => undefined }

// A wire runs along y = 0.5, across both parts and out to the label.
const wires = { at: (world: { x: number; y: number }) => (Math.abs(world.y - 0.5) < 0.1 ? "wire:W" : undefined) }

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
  test("the target under the pointer: a label, else the smallest part, else the canvas", () => {
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, free)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, labels, { x: 3, y: 0 }, free)).toEqual({ kind: "part", name: "R1" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, free)).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, note)).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, note)).toEqual({ kind: "canvas" })
  })

  test("a net label wins over a wire, and a wire over the part body under it", () => {
    const everywhere = { ...labels, at: () => label }
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0.5 }, free, wires)).toEqual({ kind: "wire", id: "wire:W" })
    expect(targetAt(BOXES, everywhere, { x: 1.5, y: 0.5 }, free, wires)).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0 }, free, wires)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, labels, { x: 6, y: 0.5 }, free, wires)).toEqual({ kind: "wire", id: "wire:W" })
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0.5 }, note, wires)).toEqual({ kind: "canvas" })
  })

  test("the parts a box takes", () => {
    const before = Selection.none.add(["U1"])
    expect(boxSelection({ parts: ["R1", "C1"] }, false)(before).names).toEqual(["R1", "C1"])
    expect(boxSelection({ parts: ["R1", "C1"] }, false, "note")(before)).toBe(Selection.none)
    expect(boxSelection({ parts: ["R1", "C1"] }, true, "note")(before)).toBe(before)
  })

  test("Select all takes every part of the circuit, each once, and keeps the selection when it already is that", () => {
    const all = selectAll(["R1", "C1", "R1"])(Selection.none)
    expect(all.names).toEqual(["R1", "C1"])
    expect(selectAll(["R1", "C1"])(all)).toBe(all)
  })

  test("Select all on the schematic also takes every wire it is given, and the Filter's Wires row can leave them out", () => {
    const every = selectAll(["R1", "C1"], undefined, undefined, ["wire:A", "wire:B"])(Selection.none.onlyWire("wire:B"))
    expect(every).toMatchObject({ names: ["R1", "C1"], wires: ["wire:A", "wire:B"] })
    expect(selectAll(["R1"], undefined, { ...ALL_PICKABLE, wires: false }, ["wire:A"])(Selection.none)).toMatchObject({ names: ["R1"], wires: [] })
    expect(selectAll(["R1"])(every)).toMatchObject({ names: ["R1"], wires: [] })
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
    expect(boxSelection({ parts: ["R1", "C1"] }, false, null, layers)(Selection.none).names).toEqual(["C1"])
    expect(pickNames(["R1", "C1"], hiding)).toEqual(["C1"])
  })
})

describe("the Filter tab", () => {
  const noParts = { ...ALL_PICKABLE, parts: false }
  const noLabels = { ...ALL_PICKABLE, labels: false }
  const noWires = { ...ALL_PICKABLE, wires: false }
  const noDrawings = { ...ALL_PICKABLE, drawings: false }

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
    // A label over a part (the sheet hover asks the same): the label while Net labels is on, else the part.
    const everywhere = { ...labels, at: () => label }
    expect(targetAt(BOXES, everywhere, { x: 1.5, y: 0 }, free)).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, everywhere, { x: 1.5, y: 0 }, { ...free, filter: noLabels })).toEqual({ kind: "part", name: "C1" })
  })

  test("a wire switched off is not picked: the click goes to the part under it", () => {
    expect(canPick({ kind: "wire", id: "wire:W" }, { ...free, filter: noWires })).toBe(false)
    expect(canPick({ kind: "wire", id: "wire:W" }, { ...free, filter: noParts })).toBe(true)
    expect(targetAt(BOXES, labels, { x: 1.5, y: 0.5 }, { ...free, filter: noWires }, wires)).toEqual({ kind: "part", name: "C1" })
  })

  test("a box takes no parts while Parts is off, and keeps the selection when it adds", () => {
    const before = Selection.none.add(["U1"])
    expect(boxSelection({ parts: ["R1", "C1"] }, false, null, undefined, noParts)(before)).toBe(Selection.none)
    expect(boxSelection({ parts: ["R1", "C1"] }, true, null, undefined, noParts)(before)).toBe(before)
    expect(boxSelection({ parts: ["R1", "C1"] }, false, null, undefined, noLabels)(before).names).toEqual(["R1", "C1"])
  })

  test("Select all takes the schematic's net labels and flags, but none while the Filter's labels row is off", () => {
    const every = selectAll(["R1"], undefined, undefined, ["wire:A"], ["label:A", "label:B"])(Selection.none)
    expect(every).toMatchObject({ names: ["R1"], wires: ["wire:A"], labels: ["label:A", "label:B"] })
    expect(selectAll(["R1"], undefined, noLabels, [], ["label:A"])(Selection.none)).toMatchObject({ names: ["R1"], labels: [] })
    expect(selectAll(["R1"])(every).labels).toEqual([])
  })

  test("a drawing is picked unless the Drawings row is off; its line sits over the parts, its fill under them", () => {
    expect(canPick({ kind: "drawing", id: "G1" }, free)).toBe(true)
    expect(canPick({ kind: "drawing", id: "G1" }, note)).toBe(false)
    expect(canPick({ kind: "drawing", id: "G1" }, { ...free, filter: noDrawings })).toBe(false)
    const line = { at: () => ({ id: "G1", place: "line" as const }) }
    const fill = { at: () => ({ id: "G2", place: "inside" as const }) }
    expect(targetAt(BOXES, undefined, { x: 1.5, y: 0 }, free, undefined, line)).toEqual({ kind: "drawing", id: "G1" })
    expect(targetAt(BOXES, undefined, { x: 1.5, y: 0 }, free, undefined, fill)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, undefined, { x: 6, y: 0 }, free, undefined, fill)).toEqual({ kind: "drawing", id: "G2" })
    expect(targetAt(BOXES, undefined, { x: 1.5, y: 0 }, { ...free, filter: noDrawings }, undefined, line)).toEqual({ kind: "part", name: "C1" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, free, undefined, line)).toEqual({ kind: "label", label })
  })

  test("Select all takes the schematic's drawings, but none while the Drawings row is off", () => {
    expect(selectAll(["R1"], undefined, undefined, [], [], ["G1", "G2"])(Selection.none)).toMatchObject({ names: ["R1"], drawings: ["G1", "G2"] })
    expect(selectAll(["R1"], undefined, noDrawings, [], [], ["G1"])(Selection.none)).toMatchObject({ names: ["R1"], drawings: [] })
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
    expect(ALL_PICKABLE).toEqual({ parts: true, labels: true, wires: true, drawings: true, tracks: true, vias: true, texts: true })
    const off = togglePickKind(ALL_PICKABLE, "labels")
    expect(off).toEqual({ parts: true, labels: false, wires: true, drawings: true, tracks: true, vias: true, texts: true })
    expect(ALL_PICKABLE.labels).toBe(true)
    expect(togglePickKind(off, "labels")).toEqual(ALL_PICKABLE)
    expect(kindPickable(undefined, "parts")).toBe(true)
    expect(pickKindRows("pcb").map((row) => row.label)).toEqual(["Parts", "Tracks", "Vias", "Designators"])
    expect(pickKindRows("pcb").map((row) => row.kind)).toEqual(["parts", "tracks", "vias", "texts"])
    expect(pickKindRows("schematic").map((row) => row.label)).toEqual(["Parts", "Wires", "Net labels and flags", "Drawings", "Names and values"])
    expect(pickKindRows("schematic").find((row) => row.label === "Names and values")?.kind).toBe("texts")
    expect(pickKindRows("schematic").find((row) => row.label === "Drawings")?.kind).toBe("drawings")
    expect(pickKindRows("schematic").find((row) => row.label === "Wires")?.kind).toBe("wires")
  })
})

describe("copper picks", () => {
  const context = (filter = ALL_PICKABLE): PickContext => ({ selection: Selection.none, armed: null, filter })
  test("tracks and vias follow their own Filter rows, and no tool that takes the press", () => {
    expect(canPick({ kind: "track", id: "t0001" }, context())).toBe(true)
    expect(canPick({ kind: "via", id: "v0001" }, context())).toBe(true)
    expect(canPick({ kind: "track", id: "t0001" }, context({ ...ALL_PICKABLE, tracks: false }))).toBe(false)
    expect(canPick({ kind: "via", id: "v0001" }, context({ ...ALL_PICKABLE, tracks: false }))).toBe(true)
    expect(canPick({ kind: "via", id: "v0001" }, context({ ...ALL_PICKABLE, vias: false }))).toBe(false)
    expect(canPick({ kind: "track", id: "t0001" }, { ...context(), armed: "note" })).toBe(false)
  })
})

describe("a part's name, value or designator", () => {
  // R1's name sits from x = 3 to 6 on y = 0: over R1's box (0 to 4) on the left, and on its own on the right.
  const texts = { at: (world: { x: number; y: number }) => (world.x >= 3 && world.x <= 6 && Math.abs(world.y) < 0.2 ? "R1:schNameAt" : undefined) }

  test("is picked after the wires and the parts: on its own it is the target, over a part's body or a wire it is not", () => {
    expect(targetAt(BOXES, undefined, { x: 5, y: 0 }, free, wires, undefined, texts)).toEqual({ kind: "text", id: "R1:schNameAt" })
    expect(targetAt(BOXES, undefined, { x: 3.5, y: 0 }, free, wires, undefined, texts)).toEqual({ kind: "part", name: "R1" })
    const wiresHere = { at: () => "wire:W" }
    expect(targetAt(BOXES, undefined, { x: 5, y: 0 }, free, wiresHere, undefined, texts)).toEqual({ kind: "wire", id: "wire:W" })
  })

  test("is not picked while the Filter tab has Names and values off, nor under the Note box tool", () => {
    const off: PickContext = { ...free, filter: { ...ALL_PICKABLE, texts: false } }
    expect(targetAt(BOXES, undefined, { x: 5, y: 0 }, off, wires, undefined, texts)).toEqual({ kind: "canvas" })
    expect(targetAt(BOXES, undefined, { x: 5, y: 0 }, note, wires, undefined, texts)).toEqual({ kind: "canvas" })
    expect(canPick({ kind: "text", id: "R1:schNameAt" }, free)).toBe(true)
  })

  test("Select all leaves the names and values out", () => {
    const before = Selection.none.toggleText("R1:schNameAt")
    expect(selectAll(["R1"])(before).texts).toEqual([])
  })
})
