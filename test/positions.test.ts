import { describe, expect, test } from "vitest"
import { movedTo, moveBlocker, nextRotation, ZERO, type SourceCircuit } from "../studio/src/pcb/positions.js"

/** A circuit whose parts have the given literal props; "expr" marks an expression. */
function circuit(parts: Record<string, Record<string, number | string>>, readonly: string[] = []): SourceCircuit {
  const model = {
    parts: Object.entries(parts).map(([name, props]) => ({
      name,
      editable: !readonly.includes(name),
      ...(readonly.includes(name) ? { readonlyReason: "made in a loop" } : {}),
      props: Object.fromEntries(
        Object.entries(props).map(([key, value]) => [key, value === "expr" ? { source: "x + 1", editable: false } : { source: String(value), literal: value, editable: true }]),
      ),
    })),
  }
  return { model } as unknown as SourceCircuit
}

describe("movedTo", () => {
  test("adds the drag to a literal position", () => {
    const at = movedTo(circuit({ R1: { pcbX: 2, pcbY: -1 } }), "R1", "pcb", { origin: { x: 12, y: -1 }, group: { x: 10, y: 0 } }, { x: 0.5, y: 1 })
    expect(at).toEqual([2.5, 0])
  })

  test("a move onto the 2 mil grid is written to 4 decimals, so 0.1524 mm stays on it", () => {
    const at = movedTo(circuit({ U1: { pcbX: 0, pcbY: 0.1016 } }), "U1", "pcb", { origin: { x: 0, y: 0.1016 }, group: ZERO }, { x: 0.1524, y: 0.0508 })
    expect(at).toEqual([0.1524, 0.1524])
  })

  test("a part without a position lands on 0.1524 mm too", () => {
    const at = movedTo(circuit({ U2: {} }), "U2", "pcb", { origin: { x: 1.0508, y: 0 }, group: { x: 1, y: 0 } }, { x: 0.1016, y: 0.1524 })
    expect(at).toEqual([0.1524, 0.1524])
  })

  test("nudging by 2 mil again and again does not drift off the grid", () => {
    let x = 0
    for (let press = 1; press <= 50; press++) {
      ;[x] = movedTo(circuit({ U1: { pcbX: x, pcbY: 0 } }), "U1", "pcb", { origin: { x, y: 0 }, group: ZERO }, { x: 0.0508, y: 0 })
      expect(x).toBe(Number((press * 0.0508).toFixed(4)))
    }
  })

  test("a part without a position gets where it sits plus the drag, relative to its group", () => {
    const at = movedTo(circuit({ R5: {} }), "R5", "schematic", { origin: { x: 13, y: 4 }, group: { x: 10, y: 1 } }, { x: 1, y: 0.5 })
    expect(at).toEqual([4, 3.5])
  })
})

describe("moveBlocker", () => {
  const data = circuit({ R1: { pcbX: "expr" }, R2: {}, RX: {} }, ["RX"])

  test("names what stops a move", () => {
    expect(moveBlocker(data, new Set(), "R1", "pcb")).toBe("R1.pcbX is an expression; change it in the code")
    expect(moveBlocker(data, new Set(), "R1", "schematic")).toBeNull()
    expect(moveBlocker(data, new Set(["R2"]), "R2", "pcb")).toBe("R2 is locked")
    expect(moveBlocker(data, new Set(), "RX", "pcb")).toBe("RX is read-only (made in a loop)")
    expect(moveBlocker(data, new Set(), "Q9", "pcb")).toBe("This part has no editable source element")
  })
})

describe("nextRotation", () => {
  test("turns a quarter and wraps, and refuses a rotation that is not a number", () => {
    expect(nextRotation(circuit({ R1: { pcbRotation: 270 } }), "R1", "pcb")).toBe(0)
    expect(nextRotation(circuit({ R1: {} }), "R1", "schematic")).toBe(90)
    expect(nextRotation(circuit({ R1: { schRotation: "90deg" } }), "R1", "schematic")).toBe("R1.schRotation is not a number")
  })
})
