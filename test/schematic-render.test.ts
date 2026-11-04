import { describe, expect, test } from "vitest"
import { drawSchematic, portAt } from "../studio/src/pcb/schematic-render.js"

function recorder() {
  const calls: string[] = []
  const texts: string[] = []
  const placed = new Map<string, { x: number; y: number }>()
  let origin = { x: 0, y: 0 }
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1, lineCap: "", lineJoin: "" }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (key === "save") origin = { x: 0, y: 0 }
        if (key === "translate") origin = { x: Number(args[0]), y: Number(args[1]) }
        if (key === "fillText") {
          texts.push(String(args[0]))
          placed.set(String(args[0]), origin)
        }
        return undefined
      }
    },
    set(target, key, value) {
      ;(target as Record<string, unknown>)[key as string] = value
      return true
    },
  })
  return { ctx: ctx as never, calls, texts, placed }
}

const SYMBOLS = {
  boxresistor_down: {
    center: { x: 0, y: 0 },
    size: { width: 0.9, height: 0.6 },
    ports: [],
    primitives: [
      { type: "path", points: [{ x: 0, y: 0.3 }, { x: 0, y: -0.3 }], color: "primary", fill: false },
      { type: "circle", x: 0, y: 0, radius: 0.1, color: "primary", fill: true },
      { type: "text", text: "{REF}", x: 0.16, y: 0.16, anchor: "middle_left" },
      { type: "text", text: "{VAL}", x: 0.16, y: -0.16, anchor: "middle_left" },
    ],
  },
  rail_down: {
    center: { x: 0, y: 0 },
    size: { width: 0.24, height: 0.23 },
    ports: [],
    primitives: [
      { type: "path", points: [{ x: -0.1, y: 0 }, { x: 0.1, y: 0 }], color: "primary", fill: false },
      { type: "text", text: "{REF}", x: 0, y: -0.14, anchor: "middle_top" },
    ],
  },
}

const JSON_ = [
  { type: "source_component", source_component_id: "s1", name: "R1" },
  { type: "source_component", source_component_id: "s2", name: "U1" },
  { type: "schematic_component", schematic_component_id: "c1", source_component_id: "s1", center: { x: 0, y: 0 }, size: { width: 0.9, height: 0.6 }, symbol_name: "boxresistor_down", symbol_display_value: "5.1kΩ" },
  { type: "schematic_component", schematic_component_id: "c2", source_component_id: "s2", center: { x: 3, y: 0 }, size: { width: 1, height: 1 } },
  { type: "schematic_port", schematic_port_id: "p1", schematic_component_id: "c2", center: { x: 3.9, y: 0.2 }, facing_direction: "right", distance_from_component_edge: 0.4, display_pin_label: "VOUT", pin_number: 5 },
  { type: "schematic_port", schematic_port_id: "p2", schematic_component_id: "c1", center: { x: 0, y: 0.3 }, facing_direction: "up", distance_from_component_edge: 0 },
  { type: "schematic_trace", schematic_trace_id: "t1", edges: [{ from: { x: 0, y: 0.3 }, to: { x: 0, y: 1 } }], junctions: [{ x: 0, y: 1 }] },
  { type: "schematic_net_label", text: "GND", center: { x: 0, y: -1 }, anchor_position: { x: 0, y: -0.9 }, anchor_side: "top", symbol_name: "rail_down" },
  { type: "schematic_net_label", text: "CC1", center: { x: 2, y: 2 }, anchor_position: { x: 2.24, y: 2 }, anchor_side: "right" },
  { type: "schematic_text", text: "AP2112K", position: { x: 3, y: 0.7 }, anchor: "bottom", font_size: 0.18, rotation: 0 },
  { type: "schematic_group", name: "board" },
  { type: "schematic_arc", center: { x: 0, y: 0 } },
]

const VIEW = { camera: { cx: 1, cy: 0, scale: 60 }, size: { width: 800, height: 600 } }

describe("drawSchematic", () => {
  test("draws symbols with their reference and value, chips with pin labels, and net labels", () => {
    const { ctx, texts } = recorder()
    const result = drawSchematic(ctx, JSON_, VIEW, { ratio: 1, symbols: SYMBOLS })
    expect(texts).toEqual(expect.arrayContaining(["R1", "5.1kΩ", "GND", "CC1", "VOUT", "5", "AP2112K"]))
    expect(texts).not.toContain("{REF}")
    expect(result.unsupported).toEqual(["schematic_arc"])
  })

  test("pins are marked only in wiring mode", () => {
    const plain = recorder()
    drawSchematic(plain.ctx, JSON_, VIEW, { ratio: 1, symbols: SYMBOLS })
    const wiring = recorder()
    drawSchematic(wiring.ctx, JSON_, VIEW, { ratio: 1, symbols: SYMBOLS, showPorts: true })
    expect(wiring.calls.filter((c) => c === "arc").length).toBeGreaterThan(plain.calls.filter((c) => c === "arc").length)
  })
})

describe("placement", () => {
  // Camera at (1, 0), 60 px per unit, 800 x 600 view: world (x, y) lands at (400 + 60(x - 1), 300 - 60y).
  test("text lands where the camera puts it, with world y pointing up", () => {
    const { ctx, placed } = recorder()
    drawSchematic(ctx, JSON_, VIEW, { ratio: 1, symbols: SYMBOLS })
    expect(placed.get("AP2112K")).toEqual({ x: 520, y: 258 })
    // VOUT sits just inside the box edge: the pin end (3.9, 0.2) minus the 0.4 lead, minus 0.06.
    expect(placed.get("VOUT")?.x).toBeCloseTo(546.4)
    expect(placed.get("VOUT")?.y).toBeCloseTo(288)
  })

  test("a component being dragged is drawn shifted, with its pin labels", () => {
    const { ctx, placed } = recorder()
    drawSchematic(ctx, JSON_, VIEW, { ratio: 1, symbols: SYMBOLS, moving: { componentId: "c2", by: { x: 1, y: 0.5 } } })
    expect(placed.get("VOUT")?.x).toBeCloseTo(606.4)
    expect(placed.get("VOUT")?.y).toBeCloseTo(258)
    // Text that belongs to no component stays put.
    expect(placed.get("AP2112K")).toEqual({ x: 520, y: 258 })
  })
})

describe("malformed circuit JSON", () => {
  test("is skipped instead of throwing", () => {
    const broken = [
      null,
      { name: "no type" },
      { type: "schematic_component", schematic_component_id: "x", symbol_name: "constructor", center: { x: 0, y: 0 } },
      { type: "schematic_net_label", text: "N", symbol_name: "__proto__", center: { x: 0, y: 0 } },
      { type: "schematic_trace", edges: [{ from: { x: 0, y: 0 } }, null], junctions: [null] },
      { type: "schematic_path", points: [null, { x: 1, y: 1 }] },
      { type: "schematic_port", schematic_port_id: "p", schematic_component_id: "x", facing_direction: "constructor", center: { x: 0, y: 0 }, distance_from_component_edge: 0.4 },
    ]
    const { ctx } = recorder()
    expect(() => drawSchematic(ctx, broken, VIEW, { ratio: 1, symbols: SYMBOLS, showPorts: true })).not.toThrow()
    expect(portAt(broken, { x: 0, y: 0 }, 0.1)).toBe("p")
  })
})

describe("portAt", () => {
  test("finds the nearest pin within the given distance", () => {
    expect(portAt(JSON_, { x: 3.85, y: 0.22 }, 0.2)).toBe("p1")
    expect(portAt(JSON_, { x: 5, y: 5 }, 0.2)).toBeUndefined()
  })
})
