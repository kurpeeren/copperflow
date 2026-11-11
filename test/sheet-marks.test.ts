import { describe, expect, test } from "vitest"
import { flaggedPins, noConnectFlags, noConnectNames, toggleNoConnect } from "../src/engine/no-connect.js"
import { drawingBounds, drawingKindOf, drawingTag, JUNCTION_RADIUS } from "../src/engine/drawing-kinds.js"
import { junctionClick, noConnectClick, pinEndAt, wirePointAt, type MarkContext } from "../studio/src/pcb/sheet-marks.js"
import { noConnectStrokes } from "../studio/src/pcb/no-connect-draw.js"

const pins = [
  { id: "U1.pin1", number: 1, names: ["pin1", "VCC"] },
  { id: "U1.pin2", number: 2, names: ["pin2", "EN"] },
]
const sheet = {
  symbols: [{ component: "U1", pinEnds: { "U1.pin1": { x: 0, y: 0 }, "U1.pin2": { x: 1, y: 0 } } }],
  wires: [{ id: "w1", points: [{ x: 0, y: 1 }, { x: 2, y: 1 }] }],
  pages: [{ name: "Main", wires: [] }, { name: "Power", wires: ["w1"] }],
}
const prop = (literal: string) => ({ literal, source: JSON.stringify(literal), editable: true })
const context = (props = {}, locked: string[] = []): MarkContext => ({
  sheet,
  components: [{ id: "U1", pins }],
  parts: [{ name: "U1", props, editable: true }],
  locked: new Set(locked),
})

describe("no connect flags in the engine", () => {
  test("the prop names pins by number or by name, trimmed and without repeats", () => {
    expect(noConnectNames(" pin2, EN ,,pin2")).toEqual(["pin2", "EN"])
    expect(noConnectNames(3)).toEqual([])
    expect(flaggedPins({ pins: pins.map((p) => ({ ...p, component: "U1", type: "passive" as const })), props: { noConnect: "EN" } })).toEqual(["U1.pin2"])
  })

  test("toggling adds pin<n> and takes away the pin however it was named", () => {
    expect(toggleNoConnect(undefined, pins[0] as (typeof pins)[0])).toBe("pin1")
    expect(toggleNoConnect("pin1,EN", pins[1] as (typeof pins)[0])).toBe("pin1")
    expect(toggleNoConnect("EN", pins[1] as (typeof pins)[0])).toBe("")
  })

  test("a flag sits at the end of each flagged pin that is drawn", () => {
    const components = [{ id: "U1", pins: pins.map((p) => ({ ...p, component: "U1", type: "passive" as const })), props: { noConnect: "pin2" } }]
    expect(noConnectFlags(components, new Map([["U1.pin2", { x: 1, y: 0 }]]))).toEqual([{ pin: "U1.pin2", component: "U1", at: { x: 1, y: 0 } }])
  })
})

describe("Place → No connect flag", () => {
  test("a click by a pin end flags it, as one setProps edit", () => {
    expect(pinEndAt(sheet, { x: 0.95, y: 0.02 }, 0.1)?.pin).toBe("U1.pin2")
    expect(noConnectClick(context(), { x: 0.95, y: 0 }, 0.1)).toEqual({ edit: { kind: "setProps", part: "U1", props: { noConnect: "pin2" } }, summary: "flag no connect on U1.pin2" })
  })

  test("a click on a flagged pin takes the flag off", () => {
    const result = noConnectClick(context({ noConnect: prop("pin2") }), { x: 1, y: 0 }, 0.1)
    expect(result).toEqual({ edit: { kind: "setProps", part: "U1", props: { noConnect: "" } }, summary: "remove the no connect flag from U1.pin2" })
  })

  test("refuses away from a pin, on a locked part and on an expression", () => {
    expect(noConnectClick(context(), { x: 5, y: 5 }, 0.1)).toHaveProperty("message")
    expect(noConnectClick(context({}, ["U1"]), { x: 0, y: 0 }, 0.1)).toEqual({ message: "U1 is locked; unlock it to change its no connect flags." })
    expect(noConnectClick(context({ noConnect: { literal: undefined, source: "{x}", editable: false } }), { x: 0, y: 0 }, 0.1)).toHaveProperty("message")
  })

  test("draws a cross of two strokes through the pin end", () => {
    const [a, b] = noConnectStrokes({ x: 1, y: 1 })
    expect(a?.[0].x).toBeLessThan(1)
    expect(b?.[1].y).toBeLessThan(1)
  })
})

describe("Place → Junction", () => {
  test("junction is a drawing tag with a dot's bounds", () => {
    expect(drawingKindOf("junction")).toBe("junction")
    expect(drawingTag("junction")).toBe("junction")
    expect(drawingBounds({ kind: "junction", x: 1, y: 2 })).toEqual({ minX: 1 - JUNCTION_RADIUS, minY: 2 - JUNCTION_RADIUS, maxX: 1 + JUNCTION_RADIUS, maxY: 2 + JUNCTION_RADIUS })
  })

  test("a click near a wire adds a junction at the nearest point, on the wire's page", () => {
    expect(wirePointAt(sheet, { x: 0.5, y: 1.05 }, 0.1)).toEqual({ wire: "w1", point: { x: 0.5, y: 1 } })
    expect(junctionClick(sheet, { x: 0.5, y: 1.05 }, 0.1)).toEqual({ edit: { kind: "addDrawing", tag: "junction", props: { x: 0.5, y: 1 }, page: "Power" }, summary: "add a junction at 0.5, 1" })
    expect(junctionClick(sheet, { x: 0.5, y: 3 }, 0.1)).toEqual({ message: "Click a wire to put a junction on it." })
  })
})
