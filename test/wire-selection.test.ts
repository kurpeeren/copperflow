import { describe, expect, test } from "vitest"
import { shownSelection, wireAfterBuild } from "../studio/src/pcb/wire-selection.js"
import { Selection } from "../studio/src/selection.js"

const p = (x: number, y: number) => ({ x, y })
const HAND = "wire:R1.pin2|R2.pin1"
const ENGINE = "wire:net.GND:1"
const hand = (points = [p(0, 0), p(1, 0), p(1, 1)]) => ({ id: HAND, connection: "R1.pin2|R2.pin1", points })
const engine = (points = [p(0, 5), p(3, 5)]) => ({ id: ENGINE, points })
const parts = Selection.none.add(["R1"])

describe("the selection after a build", () => {
  test("a wire the sheet no longer draws is dropped", () => {
    const sel = Selection.none.onlyWire(HAND)
    expect(wireAfterBuild(sel, [hand()], [engine()])).toBe(Selection.none)
    expect(wireAfterBuild(sel, undefined, [engine()])).toBe(Selection.none)
  })

  test("a hand-drawn wire stays selected though its ends moved: its id names its trace", () => {
    const sel = Selection.none.onlyWire(HAND)
    expect(wireAfterBuild(sel, [hand()], [hand([p(0, 1), p(1, 1), p(1, 2)])])).toBe(sel)
  })

  test("a wire Studio draws stays while its ends are where they were, in either order", () => {
    const sel = Selection.none.onlyWire(ENGINE)
    expect(wireAfterBuild(sel, [engine()], [engine([p(0, 5), p(1, 4), p(3, 5)])])).toBe(sel)
    expect(wireAfterBuild(sel, [engine()], [engine([p(3, 5), p(0, 5)])])).toBe(sel)
  })

  test("a wire Studio draws is dropped when its id now names another segment of the net", () => {
    const sel = Selection.none.onlyWire(ENGINE)
    expect(wireAfterBuild(sel, [engine()], [engine([p(3, 5), p(6, 5)])])).toBe(Selection.none)
  })

  test("with no build before, only presence counts; parts are left alone", () => {
    const sel = Selection.none.onlyWire(ENGINE)
    expect(wireAfterBuild(sel, undefined, [engine([p(9, 9), p(9, 8)])])).toBe(sel)
    expect(wireAfterBuild(parts, [hand()], [])).toBe(parts)
  })

  test("with parts and several wires, only the wires gone or re-pointed leave; the parts and the rest stay", () => {
    const mix = parts.addWires([HAND, ENGINE])
    expect(wireAfterBuild(mix, [hand(), engine()], [engine([p(3, 5), p(6, 5)])])).toMatchObject({ names: ["R1"], wires: [] })
    expect(wireAfterBuild(mix, [hand(), engine()], [hand(), engine([p(3, 5), p(6, 5)])])).toMatchObject({ names: ["R1"], wires: [HAND] })
    expect(wireAfterBuild(mix, [hand(), engine()], [hand(), engine()])).toBe(mix)
  })
})

describe("the selection shown", () => {
  const wire = Selection.none.onlyWire(HAND)

  test("a wire shows on the schematic while the sheet draws it", () => {
    expect(shownSelection(wire, { view: "schematic", wires: [HAND] })).toBe(wire)
    expect(shownSelection(wire, { view: "schematic", wires: [ENGINE] })).toBe(Selection.none)
    expect(shownSelection(wire, { view: "schematic" })).toBe(Selection.none)
  })

  test("the PCB never shows a wire", () => {
    expect(shownSelection(wire, { view: "pcb", wires: [HAND] })).toBe(Selection.none)
  })

  test("with parts and wires, the PCB shows the parts and the schematic the wires it draws", () => {
    const mix = Selection.none.add(["R1"]).addWires([HAND, ENGINE])
    expect(shownSelection(mix, { view: "pcb", wires: [HAND, ENGINE] })).toMatchObject({ names: ["R1"], wires: [] })
    expect(shownSelection(mix, { view: "schematic", wires: [ENGINE] })).toMatchObject({ names: ["R1"], wires: [ENGINE] })
  })

  test("parts the loaded circuit does not have yet are not shown; without a circuit every part is", () => {
    const two = Selection.none.add(["R1", "R9"])
    expect(shownSelection(two, { view: "pcb", parts: ["R1", "R2"] }).names).toEqual(["R1"])
    expect(shownSelection(two, { view: "schematic" })).toBe(two)
  })
})
