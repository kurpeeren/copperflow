import { describe, expect, test } from "vitest"
import { clicked, Selection, togglesSelection } from "../studio/src/selection.js"

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
