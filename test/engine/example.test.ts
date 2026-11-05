import { beforeAll, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { FOOTPRINT_FILE } from "../../src/engine/engine.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"

const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))
const TRACE_COUNT = 25
const SIGNAL_PADS = 6
const SHELL_SLOTS = 4

let design: Design

beforeAll(async () => {
  design = buildDesign(await collectProjectFiles(EXAMPLE, { include: FOOTPRINT_FILE }), "index.circuit.tsx")
})

/** The id of J1's pin with this name, such as "J1.pin3" for "CC1". */
function j1Pin(name: string): string {
  const pin = design.circuit.components.find((c) => c.id === "J1")?.pins.find((p) => p.names.includes(name))
  if (!pin) throw new Error(`J1 has no pin named ${name}`)
  return pin.id
}

const sorted = (ids: readonly string[]) => [...ids].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))

describe("the usb-c-ldo example", () => {
  test("builds without errors", () => {
    expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  })

  test("J1 is the TYPE-C-6P library part, where the board placed it", () => {
    const j1 = design.circuit.components.find((c) => c.id === "J1")
    expect(j1?.library).toBe("TYPE-C-6P")
    expect(j1?.pcb).toMatchObject({ x: -9.8, y: 0 })
    expect(j1?.supplierPartNumbers).toEqual({ jlcpcb: ["C456012"] })
  })

  test("its 25 traces resolve into the six named nets", () => {
    expect(design.circuit.connections).toHaveLength(TRACE_COUNT)
    const nets = Object.fromEntries(design.circuit.nets.map((net) => [net.id, sorted(net.pins)]))
    expect(nets).toEqual({
      "net.GND": sorted(["C1.pin2", "C2.pin2", j1Pin("GND1"), j1Pin("GND2"), j1Pin("EH"), "J2.pin2", "LED1.pin1", "R1.pin2", "R2.pin2", "U1.pin2"]),
      "net.VBUS": sorted(["C1.pin1", j1Pin("VBUS1"), j1Pin("VBUS2"), "U1.pin1", "U1.pin3"]),
      "net.V3_3": sorted(["C2.pin1", "J2.pin1", "R3.pin1", "U1.pin5"]),
      "net.CC1": sorted([j1Pin("CC1"), "R1.pin1"]),
      "net.CC2": sorted([j1Pin("CC2"), "R2.pin1"]),
      "net.LED_A": sorted(["LED1.pin2", "R3.pin2"]),
    })
  })

  test("every J1 pad has a net: six signal pads and four plated shell slots on GND", () => {
    const pads = design.pcb.parts.find((part) => part.component === "J1")?.pads ?? []
    expect(pads).toHaveLength(SIGNAL_PADS + SHELL_SLOTS)
    expect(pads.filter((pad) => pad.net === undefined)).toEqual([])
    const slots = pads.filter((pad) => pad.layers === "through")
    expect(slots).toHaveLength(SHELL_SLOTS)
    expect(slots.every((pad) => pad.pin === j1Pin("EH") && pad.net === "net.GND" && pad.drill !== undefined)).toBe(true)
  })
})
