import { describe, expect, test } from "vitest"
import { alreadyConnected, drawnWireAt, drawnWires, elbow, joinsNets, portEnd, wireEndAt, wireHints } from "../studio/src/pcb/wiring.js"

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
    expect(wireEndAt(JSON_, { x: 1.02, y: 0.01 }, 0.1)).toEqual({ selector: ".R1 > .pin2", at: { x: 1, y: 0 }, key: "mid", label: "R1.pin2", pinId: "p2" })
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

describe("drawnWires", () => {
  test("runs a pin-to-pin wire through its corners and hides tscircuit's own path between the two pins", () => {
    const drawn = drawnWires(JSON_, [{ from: ".R1 > .pin2", to: "C1.pin1", schematicRouteHints: [{ x: 2, y: 1 }] }])
    expect(drawn.wires).toEqual([
      [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 0 },
      ],
    ])
    expect([...drawn.hidden]).toEqual(["t1"])
  })

  test("a wire to a net ends on its last corner, with a junction, and hides nothing", () => {
    const drawn = drawnWires(JSON_, [{ from: ".C1 > .pin2", to: "net.GND", schematicRouteHints: [{ x: 4, y: -1 }, { x: 0, y: -1 }] }])
    expect(drawn.wires).toEqual([
      [
        { x: 4, y: 0 },
        { x: 4, y: -1 },
        { x: 0, y: -1 },
      ],
    ])
    expect(drawn.junctions).toEqual([{ x: 0, y: -1 }])
    expect(drawn.hidden.size).toBe(0)
  })

  test("an end on a wire of an unnamed net is written twice and stays on that wire", () => {
    const toWire = drawnWires(JSON_, [
      {
        from: ".C1 > .pin2",
        to: ".R1 > .pin2",
        schematicRouteHints: [
          { x: 4, y: 2 },
          { x: 2, y: 2 },
          { x: 2, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ])
    expect(toWire.wires).toEqual([
      [
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 0 },
      ],
    ])
    expect(toWire.junctions).toEqual([{ x: 2, y: 0 }])

    const fromWire = drawnWires(JSON_, [
      {
        from: ".R1 > .pin2",
        to: ".C1 > .pin2",
        schematicRouteHints: [
          { x: 2, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 4, y: 2 },
        ],
      },
    ])
    expect(fromWire.wires[0]?.[0]).toEqual({ x: 2, y: 0 })
    expect(fromWire.wires[0]?.at(-1)).toEqual({ x: 4, y: 0 })
    expect(fromWire.junctions).toEqual([{ x: 2, y: 0 }])
    expect(fromWire.hidden.size).toBe(0)
  })

  test("a wire from a pin to a net hides tscircuit's label stub on that pin", () => {
    const drawn = drawnWires(JSON_, [{ from: ".R1 > .pin1", to: "net.GND", schematicRouteHints: [{ x: -1, y: 0 }, { x: -1, y: -2 }] }])
    expect([...drawn.hidden].sort()).toEqual(["l1", "t2"])
  })

  test("clicking a hand-drawn wire connects to its net", () => {
    const drawn = drawnWires(JSON_, [{ from: ".R1 > .pin1", to: "net.GND", schematicRouteHints: [{ x: 0, y: 2 }] }])
    expect(drawnWireAt(drawn, { x: 0.02, y: 1 }, 0.1)).toMatchObject({ selector: ".R1 > .pin1", at: { x: 0, y: 1 }, net: "GND" })
    expect(drawnWireAt(drawn, { x: 5, y: 5 }, 0.1)).toBeUndefined()
  })

  test("traces without corners, or whose pins are not drawn, are left to tscircuit", () => {
    const drawn = drawnWires(JSON_, [
      { from: ".R1 > .pin2", to: ".C1 > .pin1" },
      { from: ".X9 > .pin1", to: ".C1 > .pin1", schematicRouteHints: [{ x: 2, y: 1 }] },
    ])
    expect(drawn.wires).toEqual([])
  })
})

describe("elbow", () => {
  test("goes across first, then up or down, like a schematic wire", () => {
    expect(elbow({ x: 0, y: 0 }, { x: 2, y: 3 })).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }])
  })
})

describe("wireHints", () => {
  const pin = { selector: ".R1 > .pin1", at: { x: 0, y: 0 }, key: "gnd", label: "R1.pin1", pinId: "p1" }
  const onNet = { selector: "net.GND", at: { x: 0, y: -1 }, key: "gnd", label: "GND", net: "GND" }
  const onUnnamedWire = { selector: ".R1 > .pin2", at: { x: 2, y: 0 }, key: "mid", label: "R1.pin2" }
  const corner = { x: 5, y: 5 }

  test("leaves pins out, keeps a net point once and an unnamed wire point twice", () => {
    expect(wireHints(pin, [corner], pin)).toEqual([corner])
    expect(wireHints(pin, [corner], onNet)).toEqual([corner, onNet.at])
    expect(wireHints(onUnnamedWire, [corner], pin)).toEqual([onUnnamedWire.at, onUnnamedWire.at, corner])
  })

  test("writes nothing when no corner was clicked, so tscircuit lays the wire out", () => {
    expect(wireHints(pin, [], onNet)).toEqual([])
  })
})
