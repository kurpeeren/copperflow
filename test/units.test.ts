import { describe, expect, test } from "vitest"
import { statusParts } from "../studio/src/pcb/status.js"
import { formatLength, fromUnit, MM_PER_MIL, nextUnit, PCB_ZOOM_REFERENCE_PX, SCHEMATIC_ZOOM_REFERENCE_PX, snapLabel, toUnit, zoomPercent } from "../studio/src/pcb/units.js"

describe("units", () => {
  test("1 mil is 0.0254 mm", () => {
    expect(MM_PER_MIL).toBe(0.0254)
    expect(toUnit(0.0254, "mil")).toBeCloseTo(1, 10)
    expect(toUnit(2.54, "mil")).toBeCloseTo(100, 10)
    expect(toUnit(2.54, "mm")).toBe(2.54)
  })

  test("mm to mil and back is the same length", () => {
    for (const mm of [0.1, 0.5, 1, 12.7]) expect(fromUnit(toUnit(mm, "mil"), "mil")).toBeCloseTo(mm, 10)
  })

  test("formats lengths with two decimals in mm and one in mil", () => {
    expect(formatLength(1.5, "mm")).toBe("1.50")
    expect(formatLength(2.54, "mil")).toBe("100.0")
    expect(formatLength(-0.0254, "mil")).toBe("-1.0")
  })

  test("a value that rounds to zero has no minus sign", () => {
    expect(formatLength(-0.001, "mm")).toBe("0.00")
  })

  test("snap labels follow the unit while the step stays in mm", () => {
    expect(snapLabel(0.1, "mm")).toBe("0.1 mm")
    expect(snapLabel(0.5, "mm")).toBe("0.5 mm")
    expect(snapLabel(1, "mm")).toBe("1 mm")
    expect(snapLabel(0.1, "mil")).toBe("3.94 mil")
    expect(snapLabel(0.5, "mil")).toBe("19.69 mil")
    expect(snapLabel(1, "mil")).toBe("39.37 mil")
  })

  test("the unit toggles between mm and mil", () => {
    expect(nextUnit("mm")).toBe("mil")
    expect(nextUnit("mil")).toBe("mm")
  })

  test("zoom is a percentage of a fixed reference: 10 px per mm on the PCB, 60 px per unit on the schematic", () => {
    expect(zoomPercent(10, PCB_ZOOM_REFERENCE_PX)).toBe(100)
    expect(zoomPercent(25, PCB_ZOOM_REFERENCE_PX)).toBe(250)
    expect(zoomPercent(0.5, PCB_ZOOM_REFERENCE_PX)).toBe(5)
    expect(zoomPercent(60, SCHEMATIC_ZOOM_REFERENCE_PX)).toBe(100)
  })
})

describe("statusParts", () => {
  test("shows zoom, X and Y in the unit", () => {
    const parts = statusParts({ cursor: { x: 2.54, y: -1 }, zoom: 12.5, unit: "mil", gesture: undefined })
    expect(parts.position).toBe("Zoom 125%  X 100.0  Y -39.4")
  })

  test("without a pointer only the zoom shows", () => {
    expect(statusParts({ cursor: undefined, zoom: 10, unit: "mm", gesture: undefined }).position).toBe("Zoom 100%")
  })

  test("a sheet without a unit shows plain numbers", () => {
    expect(statusParts({ cursor: { x: 1, y: 2 }, zoom: 60, unit: undefined, gesture: undefined }).position).toBe("Zoom 100%  X 1.00  Y 2.00")
  })

  test("a part drag shows dX and dY from its start", () => {
    const gesture = { kind: "drag", offset: { x: 1, y: -0.5 }, moved: true, blocker: null } as never
    expect(statusParts({ cursor: undefined, zoom: 10, unit: "mm", gesture }).drag).toBe("dX 1.00  dY -0.50")
  })

  test("a label drag shows how far the label moved", () => {
    const gesture = { kind: "label", label: { at: { x: 1, y: 1 } }, at: { x: 2.5, y: 0.5 }, moved: true, blocker: null } as never
    expect(statusParts({ cursor: undefined, zoom: 10, unit: undefined, gesture }).drag).toBe("dX 1.50  dY -0.50")
  })

  test("no drag text before the pointer has moved or when the move is blocked", () => {
    const still = { kind: "drag", offset: { x: 0, y: 0 }, moved: false, blocker: null } as never
    const blocked = { kind: "drag", offset: { x: 1, y: 0 }, moved: true, blocker: "R1 is locked" } as never
    expect(statusParts({ cursor: undefined, zoom: 10, unit: "mm", gesture: still }).drag).toBe("")
    expect(statusParts({ cursor: undefined, zoom: 10, unit: "mm", gesture: blocked }).drag).toBe("")
  })
})
