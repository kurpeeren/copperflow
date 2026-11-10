import { describe, expect, test } from "vitest"
import { clicked, goneFrom, Selection, togglesSelection } from "../studio/src/selection.js"

const of = (...names: string[]) => Selection.none.all(names)
const plain = { shiftKey: false, ctrlKey: false, metaKey: false }

describe("Selection", () => {
  test("starts empty, with no primary", () => {
    expect(Selection.none.names).toEqual([])
    expect(Selection.none.size).toBe(0)
    expect(Selection.none.primary).toBeUndefined()
    expect(Selection.none.has("R1")).toBe(false)
  })

  test("only selects one part, which is the primary", () => {
    const one = of("R1", "R2").only("C1")
    expect(one.names).toEqual(["C1"])
    expect(one.primary).toBe("C1")
  })

  test("toggle adds a part at the end, as the primary, and takes it out again", () => {
    const two = Selection.none.only("R1").toggle("R2")
    expect(two.names).toEqual(["R1", "R2"])
    expect(two.primary).toBe("R2")
    const back = two.toggle("R2")
    expect(back.names).toEqual(["R1"])
    expect(back.primary).toBe("R1")
  })

  test("toggling the primary out makes the one picked before it the primary", () => {
    expect(of("R1", "R2", "C1").toggle("C1").primary).toBe("R2")
    expect(of("R1", "R2", "C1").toggle("R1").primary).toBe("C1")
  })

  test("add appends the new names in order and leaves the ones already in where they are", () => {
    const added = of("R1", "R2").add(["C1", "R1", "C2", "C1"])
    expect(added.names).toEqual(["R1", "R2", "C1", "C2"])
    expect(added.primary).toBe("C2")
  })

  test("all replaces the selection with every name, each once", () => {
    const every = Selection.none.only("X9").all(["R1", "R2", "R1", "C1"])
    expect(every.names).toEqual(["R1", "R2", "C1"])
    expect(every.primary).toBe("C1")
  })

  test("clear empties it", () => {
    expect(of("R1", "R2").clear()).toBe(Selection.none)
  })

  test("has answers for every part in it", () => {
    const sel = of("R1", "C1")
    expect(["R1", "C1", "R2"].map((name) => sel.has(name))).toEqual([true, true, false])
  })

  test("without takes parts out and keep holds only the parts named", () => {
    expect(of("R1", "R2", "C1").without(["R2", "X1"]).names).toEqual(["R1", "C1"])
    expect(of("R1", "R2", "C1").keep(["C1", "R1", "X1"]).names).toEqual(["R1", "C1"])
  })

  test("a change that changes nothing returns the same selection", () => {
    const sel = of("R1", "R2")
    expect(sel.add(["R1"])).toBe(sel)
    expect(sel.keep(["R1", "R2", "C1"])).toBe(sel)
    expect(sel.without(["C1"])).toBe(sel)
    expect(sel.all(["R1", "R2"])).toBe(sel)
    const one = sel.only("R2")
    expect(one.only("R2")).toBe(one)
    expect(Selection.none.clear()).toBe(Selection.none)
  })

  test("never changes the selection it was made from", () => {
    const sel = of("R1", "R2")
    sel.toggle("C1")
    sel.toggle("R1")
    sel.add(["C2"])
    sel.only("C3")
    sel.clear()
    expect(sel.names).toEqual(["R1", "R2"])
    expect(Object.isFrozen(sel.names)).toBe(true)
    expect(Object.isFrozen(sel)).toBe(true)
  })

  test("an empty name list empties it", () => {
    expect(of("R1").all([])).toBe(Selection.none)
    expect(of("R1").keep([])).toBe(Selection.none)
  })
})

describe("parts and wires together", () => {
  const W = "wire:R1.pin2|R2.pin1"
  const V = "wire:R3.pin1|R4.pin2"
  const wire = Selection.none.onlyWire(W)
  const mix = of("R1", "R2").addWires([W, V])

  test("a wire alone: no parts, no primary, the part counts at zero, and one object in all", () => {
    expect(wire.wires).toEqual([W])
    expect(wire.wireCount).toBe(1)
    expect(wire.names).toEqual([])
    expect(wire.size).toBe(0)
    expect(wire.primary).toBeUndefined()
    expect(wire.total).toBe(1)
    expect(wire.soleWire).toBe(W)
    expect(Selection.none.wires).toEqual([])
    expect(Selection.none.total).toBe(0)
  })

  test("parts and wires are held together, each in pick order; the part counts count parts only", () => {
    expect(mix.names).toEqual(["R1", "R2"])
    expect(mix.wires).toEqual([W, V])
    expect(mix.size).toBe(2)
    expect(mix.primary).toBe("R2")
    expect(mix.wireCount).toBe(2)
    expect(mix.total).toBe(4)
    expect(mix.hasWire(V)).toBe(true)
    expect(mix.hasWire("wire:other")).toBe(false)
    expect(mix.soleWire).toBeUndefined()
    expect(of("R1").addWires([W]).soleWire).toBeUndefined()
    expect(Selection.none.onlyWire(W).addWires([V]).soleWire).toBeUndefined()
  })

  test("onlyWire selects that wire alone, dropping the parts; again changes nothing", () => {
    expect(mix.onlyWire(W)).toMatchObject({ names: [], wires: [W] })
    expect(wire.onlyWire(W)).toBe(wire)
    expect(wire.onlyWire(V).wires).toEqual([V])
  })

  test("toggleWire adds a wire after the others and takes it out again, keeping the parts", () => {
    const added = of("R1").toggleWire(W).toggleWire(V)
    expect(added).toMatchObject({ names: ["R1"], wires: [W, V] })
    expect(added.toggleWire(W)).toMatchObject({ names: ["R1"], wires: [V] })
    expect(wire.toggleWire(W)).toBe(Selection.none)
  })

  test("part changes keep the wires; only, clear and all do not", () => {
    expect(mix.toggle("C1")).toMatchObject({ names: ["R1", "R2", "C1"], wires: [W, V] })
    expect(mix.toggle("R1")).toMatchObject({ names: ["R2"], wires: [W, V] })
    expect(mix.add(["C1"])).toMatchObject({ names: ["R1", "R2", "C1"], wires: [W, V] })
    expect(mix.without(["R1", "R2"])).toMatchObject({ names: [], wires: [W, V] })
    expect(mix.keep(["R2"])).toMatchObject({ names: ["R2"], wires: [W, V] })
    expect(mix.only("R1")).toMatchObject({ names: ["R1"], wires: [] })
    expect(mix.clear()).toBe(Selection.none)
  })

  test("all replaces both lists, each name once; the wires may be left out", () => {
    expect(mix.all(["C1"])).toMatchObject({ names: ["C1"], wires: [] })
    expect(Selection.none.all(["R1", "R1"], [V, W, V])).toMatchObject({ names: ["R1"], wires: [V, W] })
    expect(mix.all(["R1", "R2"], [W, V])).toBe(mix)
    expect(wire.all([])).toBe(Selection.none)
    expect(wire.all([], [W])).toBe(wire)
  })

  test("addWires appends new wires, withoutWires and keepWires take them out; a change of nothing is the same selection", () => {
    expect(mix.addWires([V, "wire:new"]).wires).toEqual([W, V, "wire:new"])
    expect(mix.addWires([W])).toBe(mix)
    expect(mix.withoutWires([W])).toMatchObject({ names: ["R1", "R2"], wires: [V] })
    expect(mix.withoutWires(["wire:other"])).toBe(mix)
    expect(mix.keepWires([V, "wire:other"])).toMatchObject({ names: ["R1", "R2"], wires: [V] })
    expect(mix.keepWires([W, V])).toBe(mix)
    expect(wire.keepWires([])).toBe(Selection.none)
    const parts = of("R1")
    expect(parts.keepWires([])).toBe(parts)
  })

  test("is frozen like any selection, its wire list too", () => {
    expect(Object.isFrozen(mix)).toBe(true)
    expect(Object.isFrozen(mix.wires)).toBe(true)
  })
})

describe("net labels and flags in the selection", () => {
  const W = "wire:R1.pin2|R2.pin1"
  const L = "label:c3"
  const G = "label:n1:R1.pin1"
  const label = Selection.none.onlyLabel(L)
  const mix = of("R1").addWires([W]).addLabels([L, G])

  test("a label alone: no parts or wires, one object in all, and it is the sole label", () => {
    expect(label.labels).toEqual([L])
    expect(label.labelCount).toBe(1)
    expect(label.total).toBe(1)
    expect(label.soleLabel).toBe(L)
    expect(label.soleWire).toBeUndefined()
    expect(Selection.none.labels).toEqual([])
    expect(Selection.none.soleLabel).toBeUndefined()
  })

  test("labels are held with parts and wires in pick order and counted in the total", () => {
    expect(mix.labels).toEqual([L, G])
    expect(mix.total).toBe(4)
    expect(mix.hasLabel(G)).toBe(true)
    expect(mix.hasLabel("label:other")).toBe(false)
    expect(mix.soleLabel).toBeUndefined()
    expect(Selection.none.onlyWire(W).addLabels([L]).soleWire).toBeUndefined()
  })

  test("onlyLabel selects that label alone; again changes nothing", () => {
    expect(mix.onlyLabel(L)).toMatchObject({ names: [], wires: [], labels: [L] })
    expect(label.onlyLabel(L)).toBe(label)
  })

  test("toggleLabel adds a label and takes it out, keeping the rest", () => {
    expect(of("R1").toggleLabel(L).toggleLabel(G)).toMatchObject({ names: ["R1"], labels: [L, G] })
    expect(mix.toggleLabel(L)).toMatchObject({ names: ["R1"], wires: [W], labels: [G] })
    expect(label.toggleLabel(L)).toBe(Selection.none)
  })

  test("part and wire changes keep the labels; only, onlyWire, clear and all without labels do not", () => {
    expect(mix.toggle("C1").labels).toEqual([L, G])
    expect(mix.toggleWire(W).labels).toEqual([L, G])
    expect(mix.add(["C1"]).labels).toEqual([L, G])
    expect(mix.addWires(["wire:x"]).labels).toEqual([L, G])
    expect(mix.without(["R1"]).labels).toEqual([L, G])
    expect(mix.withoutWires([W]).labels).toEqual([L, G])
    expect(mix.keep([]).labels).toEqual([L, G])
    expect(mix.keepWires([]).labels).toEqual([L, G])
    expect(mix.only("R1").labels).toEqual([])
    expect(mix.onlyWire(W).labels).toEqual([])
    expect(mix.all(["R1"], [W]).labels).toEqual([])
  })

  test("all replaces the three lists, each once", () => {
    expect(Selection.none.all(["R1"], [W], [L, G, L])).toMatchObject({ names: ["R1"], wires: [W], labels: [L, G] })
    expect(mix.all(["R1"], [W], [L, G])).toBe(mix)
    expect(label.all([], [], [L])).toBe(label)
  })

  test("addLabels, withoutLabels and keepLabels; a change of nothing is the same selection", () => {
    expect(mix.addLabels([G, "label:new"]).labels).toEqual([L, G, "label:new"])
    expect(mix.addLabels([L])).toBe(mix)
    expect(mix.withoutLabels([L])).toMatchObject({ names: ["R1"], wires: [W], labels: [G] })
    expect(mix.withoutLabels(["label:other"])).toBe(mix)
    expect(mix.keepLabels([G, "label:other"]).labels).toEqual([G])
    expect(mix.keepLabels([L, G])).toBe(mix)
    expect(label.keepLabels([])).toBe(Selection.none)
    expect(label.withoutLabels([L])).toBe(Selection.none)
  })

  test("a selection of only labels is not empty for the part and wire lists either", () => {
    expect(label.without(["R1"])).toBe(label)
    expect(label.keepWires([])).toBe(label)
    expect(Object.isFrozen(mix.labels)).toBe(true)
  })
})

describe("drawings in the selection", () => {
  const W = "wire:R1.pin2|R2.pin1"
  const L = "label:c3"
  const D = "G1"
  const E = "drawing:path:1"
  const drawing = Selection.none.onlyDrawing(D)
  const mix = of("R1").addWires([W]).addLabels([L]).addDrawings([D, E])

  test("a drawing alone: one object in all, and it is the sole drawing", () => {
    expect(drawing.drawings).toEqual([D])
    expect(drawing.drawingCount).toBe(1)
    expect(drawing.total).toBe(1)
    expect(drawing.soleDrawing).toBe(D)
    expect(drawing.soleWire).toBeUndefined()
    expect(drawing.soleLabel).toBeUndefined()
    expect(Selection.none.drawings).toEqual([])
    expect(Selection.none.soleDrawing).toBeUndefined()
  })

  test("drawings are held with parts, wires and labels in pick order and counted in the total", () => {
    expect(mix.drawings).toEqual([D, E])
    expect(mix.total).toBe(5)
    expect(mix.hasDrawing(E)).toBe(true)
    expect(mix.hasDrawing("G9")).toBe(false)
    expect(mix.soleDrawing).toBeUndefined()
    expect(Selection.none.onlyLabel(L).addDrawings([D]).soleLabel).toBeUndefined()
  })

  test("onlyDrawing selects that drawing alone; again changes nothing", () => {
    expect(mix.onlyDrawing(D)).toMatchObject({ names: [], wires: [], labels: [], drawings: [D] })
    expect(drawing.onlyDrawing(D)).toBe(drawing)
  })

  test("toggleDrawing adds a drawing and takes it out, keeping the rest", () => {
    expect(of("R1").toggleDrawing(D).toggleDrawing(E)).toMatchObject({ names: ["R1"], drawings: [D, E] })
    expect(mix.toggleDrawing(D)).toMatchObject({ names: ["R1"], wires: [W], labels: [L], drawings: [E] })
    expect(drawing.toggleDrawing(D)).toBe(Selection.none)
  })

  test("part, wire and label changes keep the drawings; only, onlyWire, onlyLabel, clear and all without drawings do not", () => {
    expect(mix.toggle("C1").drawings).toEqual([D, E])
    expect(mix.toggleWire(W).drawings).toEqual([D, E])
    expect(mix.toggleLabel(L).drawings).toEqual([D, E])
    expect(mix.add(["C1"]).addWires(["wire:x"]).addLabels(["label:x"]).drawings).toEqual([D, E])
    expect(mix.without(["R1"]).withoutWires([W]).withoutLabels([L]).drawings).toEqual([D, E])
    expect(mix.keep([]).keepWires([]).keepLabels([]).drawings).toEqual([D, E])
    expect(mix.only("R1").drawings).toEqual([])
    expect(mix.onlyWire(W).drawings).toEqual([])
    expect(mix.onlyLabel(L).drawings).toEqual([])
    expect(mix.all(["R1"], [W], [L]).drawings).toEqual([])
  })

  test("all replaces the four lists, each once", () => {
    expect(Selection.none.all(["R1"], [W], [L], [D, E, D])).toMatchObject({ names: ["R1"], wires: [W], labels: [L], drawings: [D, E] })
    expect(mix.all(["R1"], [W], [L], [D, E])).toBe(mix)
    expect(drawing.all([], [], [], [D])).toBe(drawing)
  })

  test("addDrawings, withoutDrawings and keepDrawings; a change of nothing is the same selection", () => {
    expect(mix.addDrawings([E, "G3"]).drawings).toEqual([D, E, "G3"])
    expect(mix.addDrawings([D])).toBe(mix)
    expect(mix.withoutDrawings([D])).toMatchObject({ names: ["R1"], wires: [W], labels: [L], drawings: [E] })
    expect(mix.withoutDrawings(["G9"])).toBe(mix)
    expect(mix.keepDrawings([E, "G9"]).drawings).toEqual([E])
    expect(mix.keepDrawings([D, E])).toBe(mix)
    expect(drawing.keepDrawings([])).toBe(Selection.none)
    expect(drawing.withoutDrawings([D])).toBe(Selection.none)
    expect(drawing.without(["R1"]).keepWires([]).keepLabels([])).toBe(drawing)
    expect(Object.isFrozen(mix.drawings)).toBe(true)
  })
})

describe("copper in the selection", () => {
  const T = "t0001"
  const V = "v0001"
  const track = Selection.none.onlyCopper(T)
  const mix = of("R1").addDrawings(["G1"]).addCopper([T, V])

  test("a track alone: one object, the sole copper, and no part", () => {
    expect(track.copper).toEqual([T])
    expect(track.copperCount).toBe(1)
    expect(track.total).toBe(1)
    expect(track.soleCopper).toBe(T)
    expect(track.size).toBe(0)
    expect(track.soleWire).toBeUndefined()
    expect(Selection.none.copper).toEqual([])
    expect(Selection.none.soleCopper).toBeUndefined()
  })

  test("copper is held with the other kinds in pick order and counted in the total", () => {
    expect(mix.copper).toEqual([T, V])
    expect(mix.total).toBe(4)
    expect(mix.hasCopper(V)).toBe(true)
    expect(mix.soleCopper).toBeUndefined()
  })

  test("onlyCopper, toggleCopper, withoutCopper and keepCopper; no change is the same selection", () => {
    expect(mix.onlyCopper(V)).toMatchObject({ names: [], drawings: [], copper: [V] })
    expect(track.onlyCopper(T)).toBe(track)
    expect(of("R1").toggleCopper(T).toggleCopper(V)).toMatchObject({ names: ["R1"], copper: [T, V] })
    expect(track.toggleCopper(T)).toBe(Selection.none)
    expect(mix.withoutCopper([T])).toMatchObject({ names: ["R1"], copper: [V] })
    expect(mix.withoutCopper(["t0009"])).toBe(mix)
    expect(mix.keepCopper([V, "v0009"]).copper).toEqual([V])
    expect(mix.keepCopper([T, V])).toBe(mix)
    expect(track.keepCopper([])).toBe(Selection.none)
    expect(mix.addCopper([T])).toBe(mix)
    expect(Object.isFrozen(mix.copper)).toBe(true)
  })

  test("the other kinds' changes keep the copper; only, all and clear do not", () => {
    expect(mix.toggle("C1").copper).toEqual([T, V])
    expect(mix.without(["R1"]).withoutDrawings(["G1"]).copper).toEqual([T, V])
    expect(mix.keep([]).keepWires([]).keepLabels([]).keepDrawings([]).copper).toEqual([T, V])
    expect(mix.only("R1").copper).toEqual([])
    expect(mix.all(["R1"]).copper).toEqual([])
    expect(Selection.none.all([], [], [], [], [T, T])).toMatchObject({ copper: [T] })
    expect(mix.clear()).toBe(Selection.none)
  })
})

describe("a click on a part", () => {
  test("selects that part alone", () => {
    expect(clicked("C1", plain)(of("R1", "R2")).names).toEqual(["C1"])
  })

  test("with Shift or Ctrl (Cmd on a Mac) toggles it in or out", () => {
    for (const held of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const modifiers = { ...plain, ...held }
      expect(togglesSelection(modifiers)).toBe(true)
      expect(clicked("C1", modifiers)(of("R1")).names).toEqual(["R1", "C1"])
      expect(clicked("R1", modifiers)(of("R1", "C1")).names).toEqual(["C1"])
    }
    expect(togglesSelection(plain)).toBe(false)
  })
})

describe("goneFrom", () => {
  test("names the parts the circuit had before and has no longer, in their order", () => {
    expect(goneFrom(["R1", "R2", "C1", "C2"], ["C1", "R1", "R9"])).toEqual(["R2", "C2"])
  })

  test("a part that was never in the circuit (placed and not built yet) is not gone", () => {
    expect(goneFrom(["R1"], ["R1"])).toEqual([])
    expect(goneFrom([], ["R1"])).toEqual([])
  })
})

describe("names, values and designators", () => {
  test("one alone is the sole text; it counts in the total but not as a part", () => {
    const one = Selection.none.onlyText("R1:schNameAt")
    expect(one.soleText).toBe("R1:schNameAt")
    expect(one.total).toBe(1)
    expect(one.size).toBe(0)
    expect(one.onlyText("R1:schNameAt")).toBe(one)
    const two = one.add(["R1"])
    expect(two.soleText).toBeUndefined()
    expect(two.toggleText("R1:schNameAt").texts).toEqual([])
    expect(two.keepTexts([]).texts).toEqual([])
    expect(one.toggleText("R1:schNameAt")).toBe(Selection.none)
  })
})
