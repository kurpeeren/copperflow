import { afterEach, describe, expect, test } from "vitest"
import { armedPart, armPart, disarmPart, partTakers, placeArmed, placing, setPartPlacer, takeParts } from "../studio/src/shell/armed-part.js"
import { placeAtOnce, placedToast, placedPosition, placeHint, placeRequest } from "../studio/src/pcb/part-place.js"

describe("placeHint", () => {
  test("names the part and the view, and how to stop", () => {
    expect(placeHint("schematic", "resistor")).toBe("Click on the sheet to place resistor (Esc cancels)")
    expect(placeHint("pcb", "led")).toBe("Click on the board to place led (Esc cancels)")
  })
})

describe("placedPosition", () => {
  test("the schematic writes schX and schY on the grid", () => {
    expect(placedPosition("schematic", { x: 1.234, y: -0.48 }, 0.1, true)).toEqual({ schX: 1.2, schY: -0.5 })
  })

  test("the board writes pcbX and pcbY on the grid", () => {
    expect(placedPosition("pcb", { x: 3.3, y: 4.74 }, 0.5, true)).toEqual({ pcbX: 3.5, pcbY: 4.5 })
  })

  test("with Snap off the point is kept, rounded as a drag rounds it", () => {
    expect(placedPosition("pcb", { x: 3.123456, y: 1 }, 0.5, false)).toEqual({ pcbX: 3.1235, pcbY: 1 })
  })
})

describe("placeRequest", () => {
  test("a built-in part gets its starting props and the position", () => {
    expect(placeRequest("resistor", { schX: 1, schY: 2 })).toEqual({ resistance: "10k", footprint: "0402", schX: 1, schY: 2 })
  })

  test("a library part gets the position only", () => {
    expect(placeRequest("ldo-3v3", { pcbX: 1, pcbY: 2 })).toEqual({ pcbX: 1, pcbY: 2 })
  })

  test("with no position, only the starting props", () => {
    expect(placeRequest("pinheader")).toEqual({ pinCount: 4 })
  })
})

describe("placedToast", () => {
  test("on the schematic it says where", () => {
    expect(placedToast("R1", { view: "schematic", props: { schX: 1.2, schY: -0.5 } }, true)).toBe("Placed R1 at 1.2, -0.5 on the schematic. It has a starting value; change it on the right.")
  })

  test("on the board it says where, in mm, and does not ask for a drag", () => {
    const text = placedToast("U1", { view: "pcb", props: { pcbX: 3.5, pcbY: 4 } }, false)
    expect(text).toBe("Placed U1 at 3.5, 4 mm on the board.")
    expect(text).not.toContain("Drag")
  })

  test("with no canvas open the engine places it, and the toast says so", () => {
    expect(placedToast("C1", undefined, true)).toBe(
      "Placed C1. It has a starting value; change it on the right. Studio placed it for now; open the schematic or the PCB and drag it where it goes.",
    )
  })
})

describe("the armed part", () => {
  afterEach(() => {
    disarmPart()
    setPartPlacer(null)
  })

  test("arming needs a canvas that takes the click; without one it is not armed", () => {
    expect(armPart("resistor")).toBe(false)
    expect(armedPart()).toBeNull()
  })

  test("a canvas that takes parts lets a part be armed, and its leaving disarms it", () => {
    const leave = takeParts("schematic")
    expect(partTakers()).toEqual(["schematic"])
    expect(armPart("resistor")).toBe(true)
    expect(armedPart()).toBe("resistor")
    leave()
    expect(partTakers()).toEqual([])
    expect(armedPart()).toBeNull()
  })

  test("arming another part replaces it; disarm puts it away", () => {
    const leave = takeParts("pcb")
    armPart("resistor")
    armPart("led")
    expect(armedPart()).toBe("led")
    disarmPart()
    expect(armedPart()).toBeNull()
    leave()
  })

  test("a click places the armed part through the placer and keeps it armed", () => {
    const leave = takeParts("schematic")
    const placed: unknown[] = []
    setPartPlacer((part, at) => void placed.push({ part, at }))
    armPart("resistor")
    expect(placeArmed({ view: "schematic", props: { schX: 1, schY: 2 } })).toBe(true)
    expect(placed).toEqual([{ part: "resistor", at: { view: "schematic", props: { schX: 1, schY: 2 } } }])
    expect(armedPart()).toBe("resistor")
    leave()
  })

  test("a click with nothing armed places nothing", () => {
    const placed: unknown[] = []
    setPartPlacer((part) => void placed.push(part))
    expect(placeArmed({ view: "pcb", props: { pcbX: 0, pcbY: 0 } })).toBe(false)
    expect(placed).toEqual([])
  })
})

describe("keyboard and quick clicks", () => {
  afterEach(() => {
    disarmPart()
    setPartPlacer(null)
  })

  test("a Place button pressed with the keyboard (detail 0) places at once; a pointer click arms", () => {
    expect(placeAtOnce(0)).toBe(true)
    expect(placeAtOnce(1)).toBe(false)
  })

  test("placed at once by the keyboard, the toast says Studio picked the spot", () => {
    expect(placedToast("R1", undefined, false, "keyboard")).toBe("Placed R1. Studio picked its spot; drag it where it goes, or pick it with the pointer and click where it goes.")
  })

  test("a click while a place request is in flight is ignored", async () => {
    const leave = takeParts("schematic")
    let finish: () => void = () => undefined
    const sent: string[] = []
    setPartPlacer((part) => {
      sent.push(part)
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    armPart("resistor")
    expect(placeArmed({ view: "schematic", props: { schX: 0, schY: 0 } })).toBe(true)
    expect(placing()).toBe(true)
    expect(placeArmed({ view: "schematic", props: { schX: 1, schY: 0 } })).toBe(false)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(placing()).toBe(false)
    expect(placeArmed({ view: "schematic", props: { schX: 2, schY: 0 } })).toBe(true)
    expect(sent).toEqual(["resistor", "resistor"])
    finish()
    leave()
  })
})
