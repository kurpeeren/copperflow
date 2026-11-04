import { describe, expect, test } from "vitest"
import { alreadyConnected, elbow, joinsNets, portEnd, wireEndAt } from "../studio/src/pcb/wiring.js"

// R1 sits between GND (left pin) and an unnamed net shared with C1 (right pin); C1.pin2 is free.
const JSON_ = [
  { type: "source_component", source_component_id: "s1", name: "R1" },
  { type: "source_component", source_component_id: "s2", name: "C1" },
  { type: "source_port", source_port_id: "sp1", source_component_id: "s1", name: "pin1", subcircuit_connectivity_map_key: "gnd" },
  { type: "source_port", source_port_id: "sp2", source_component_id: "s1", name: "pin2", subcircuit_connectivity_map_key: "mid" },
  { type: "source_port", source_port_id: "sp3", source_component_id: "s2", name: "pin1", subcircuit_connectivity_map_key: "mid" },
  { type: "source_port", source_port_id: "sp4", source_component_id: "s2", name: "pin2" },
  { type: "source_net", source_net_id: "n1", name: "GND", subcircuit_connectivity_map_key: "gnd" },
  { type: "schematic_port", schematic_port_id: "p1", source_port_id: "sp1", center: { x: 0, y: 0 } },
  { type: "schematic_port", schematic_port_id: "p2", source_port_id: "sp2", center: { x: 1, y: 0 } },
  { type: "schematic_port", schematic_port_id: "p3", source_port_id: "sp3", center: { x: 3, y: 0 } },
  { type: "schematic_port", schematic_port_id: "p4", source_port_id: "sp4", center: { x: 4, y: 0 } },
  { type: "schematic_trace", schematic_trace_id: "t1", subcircuit_connectivity_map_key: "mid", edges: [{ from: { x: 1, y: 0 }, to: { x: 3, y: 0 } }] },
  { type: "schematic_trace", schematic_trace_id: "t2", subcircuit_connectivity_map_key: "gnd", edges: [{ from: { x: 0, y: 0 }, to: { x: 0, y: -1 } }] },
  { type: "schematic_net_label", schematic_net_label_id: "l1", source_net_id: "n1", text: "GND", center: { x: 0, y: -1.2 }, anchor_position: { x: 0, y: -1 } },
]

describe("wireEndAt", () => {
  test("a pin wins over the wire that ends on it", () => {
    expect(wireEndAt(JSON_, { x: 1.02, y: 0.01 }, 0.1)).toEqual({ selector: ".R1 > .pin2", at: { x: 1, y: 0 }, key: "mid", label: "R1.pin2" })
  })

  test("a wire connects to its named net, at the nearest point on the wire", () => {
    expect(wireEndAt(JSON_, { x: 0.03, y: -0.5 }, 0.1)).toEqual({ selector: "net.GND", at: { x: 0, y: -0.5 }, key: "gnd", label: "GND", net: "GND" })
  })

  test("a wire without a named net connects to one of its pins", () => {
    expect(wireEndAt(JSON_, { x: 2, y: 0.05 }, 0.1)).toMatchObject({ selector: ".R1 > .pin2", at: { x: 2, y: 0 }, key: "mid" })
  })

  test("a net label connects to its net", () => {
    expect(wireEndAt(JSON_, { x: 0.1, y: -1.25 }, 0.1)).toMatchObject({ selector: "net.GND", at: { x: 0, y: -1 } })
  })

  test("nothing near gives nothing", () => {
    expect(wireEndAt(JSON_, { x: 10, y: 10 }, 0.1)).toBeUndefined()
  })
})

describe("alreadyConnected", () => {
  test("ends on the same net are connected; free pins are not", () => {
    const r1pin2 = portEnd(JSON_, "p2")
    const c1pin1 = portEnd(JSON_, "p3")
    const c1pin2 = portEnd(JSON_, "p4")
    expect(r1pin2 && c1pin1 && alreadyConnected(r1pin2, c1pin1)).toBe(true)
    expect(r1pin2 && c1pin2 && alreadyConnected(r1pin2, c1pin2)).toBe(false)
    expect(c1pin2 && alreadyConnected(c1pin2, c1pin2)).toBe(true)
  })
})

describe("joinsNets", () => {
  test("names the two nets a wire would short, and nothing for a free pin or the same net", () => {
    const gndPin = portEnd(JSON_, "p1")
    const freePin = portEnd(JSON_, "p4")
    const vcc = { selector: "net.VCC", at: { x: 0, y: 0 }, key: "vcc", label: "VCC", net: "VCC" }
    expect(gndPin?.net).toBe("GND")
    expect(gndPin && joinsNets(gndPin, vcc)).toEqual(["GND", "VCC"])
    expect(freePin && joinsNets(freePin, vcc)).toBeUndefined()
    expect(gndPin && joinsNets(gndPin, { ...vcc, net: "GND" })).toBeUndefined()
  })
})

describe("elbow", () => {
  test("goes across first, then up or down, like a schematic wire", () => {
    expect(elbow({ x: 0, y: 0 }, { x: 2, y: 3 })).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }])
  })
})
