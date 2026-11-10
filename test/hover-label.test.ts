import { describe, expect, test } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { copperAt } from "../studio/src/pcb/copper-hit.js"
import type { PartBox, Point } from "../studio/src/pcb/geometry.js"
import { targetAt } from "../studio/src/pcb/gestures.js"
import { hoverTarget, type PcbHoverScene, type SheetHoverScene } from "../studio/src/pcb/hover-label.js"
import { DEFAULT_LAYERS, type LayerVisibility } from "../studio/src/pcb/layers.js"
import { padAt } from "../studio/src/pcb/pcb-draw.js"
import type { PickContext } from "../studio/src/pcb/pick.js"
import { ALL_PICKABLE } from "../studio/src/pcb/pick-filter.js"
import { Selection } from "../studio/src/selection.js"

const p = (x: number, y: number): Point => ({ x, y })
const PICK: PickContext = { selection: Selection.none, armed: null }

const pin = (component: string, number: number, ...names: string[]) => ({ id: `${component}.pin${number}`, component, number, names: [`pin${number}`, ...names], type: "passive" })
const pad = (component: string, number: string, at: Point, net?: string) => ({
  id: `${component}#${number}`,
  number,
  shape: "rect" as const,
  x: at.x,
  y: at.y,
  width: 1,
  height: 1,
  rotation: 0,
  layers: "top" as const,
  component,
  pin: `${component}.pin${number}`,
  ...(net === undefined ? {} : { net }),
})
const box = (name: string, minX: number, maxX: number): PartBox => ({ name, pcbComponentId: name, center: { x: (minX + maxX) / 2, y: 0 }, box: { minX, minY: -2, maxX, maxY: 2 } })

const CIRCUIT = {
  components: [
    { id: "U1", props: { pinLabels: { pin5: "VOUT" } }, pins: [pin("U1", 5, "VOUT"), pin("U1", 1)] },
    { id: "R101", instance: "PS1", props: {}, pins: [pin("R101", 2, "right")] },
  ],
  nets: [
    { id: "net.V3_3", names: ["V3_3"], pins: ["U1.pin5"] },
    { id: "net.PS1/FB", names: ["PS1/FB"], pins: ["R101.pin2"] },
    { id: "net.GND", names: ["GND"], pins: [] },
  ],
  instances: [
    {
      name: "PS1",
      path: "PS1",
      ports: [
        { name: "VIN", side: "left", order: 0, net: "VBUS" },
        { name: "D", side: "right", order: 0, bus: true, net: "D[0:7]", members: ["D0", "D1"] },
      ],
    },
  ],
}

const track = (id: string, y: number, by: "router" | "human") => ({ id, net: "net.GND", layer: "top" as const, width: 0.25, points: [p(-10, y), p(30, y)], locked: false, by, pads: [] })

function pcbScene(visible: LayerVisibility = DEFAULT_LAYERS, context: PickContext = PICK): PcbHoverScene {
  const parts = [
    { component: "U1", side: "top", pads: [pad("U1", "5", p(0, 0), "net.V3_3"), pad("U1", "1", p(2, 0))] },
    { component: "R101", side: "top", pads: [pad("R101", "2", p(10, 0), "net.PS1/FB")] },
  ]
  return {
    view: "pcb",
    design: { circuit: CIRCUIT, pcb: { parts, tracks: [], vias: [], ratsnest: [] } } as unknown as PcbHoverScene["design"],
    copper: {
      tracks: [track("t0012", 5, "router"), track("t0013", 8, "human")],
      vias: [{ id: "v0003", net: "net.GND", at: p(20, 0), drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" }],
    },
    scale: 20,
    layers: { visible, of: () => ["top"] },
    context,
    boxes: [box("U1", -1, 3), box("R101", 9, 11)],
  }
}

describe("hover labels on the PCB", () => {
  test("a pad names the part, the pad number, the pin's own name and the net", () => {
    expect(hoverTarget(p(0.1, 0.1), pcbScene())).toEqual({ kind: "pad", id: "U1#5", text: "U1.5 VOUT · V3_3" })
  })

  test("a pad without a pin name, or without a net, says so", () => {
    expect(hoverTarget(p(2, 0), pcbScene())?.text).toBe("U1.1 · no net")
  })

  test("a pad of a sub-sheet instance shows the flattened designator, its net and the instance", () => {
    expect(hoverTarget(p(10, 0), pcbScene())?.text).toBe("R101.2 · PS1/FB [PS1]")
  })

  test("a via names its layers; a track its width and layer, and router copper says so", () => {
    expect(hoverTarget(p(20, 0.1), pcbScene())).toEqual({ kind: "via", id: "v0003", text: "via v0003 · GND · top–bottom" })
    expect(hoverTarget(p(4, 5.05), pcbScene())).toEqual({ kind: "track", id: "t0012", text: "track t0012 · GND · 0.25 mm · top · routed" })
    expect(hoverTarget(p(4, 8), pcbScene())?.text).toBe("track t0013 · GND · 0.25 mm · top")
  })

  test("nothing under the pointer, or a part's body, has no label", () => {
    expect(hoverTarget(p(5, 20), pcbScene())).toBeUndefined()
    expect(hoverTarget(p(1, 1.5), pcbScene())).toBeUndefined()
  })

  test("copper and pads on hidden layers, or of kinds the Filter tab turned off, have no label", () => {
    expect(hoverTarget(p(0, 0), pcbScene({ ...DEFAULT_LAYERS, top: false }))).toBeUndefined()
    expect(hoverTarget(p(4, 5), pcbScene({ ...DEFAULT_LAYERS, top: false }))).toBeUndefined()
    expect(hoverTarget(p(20, 0), pcbScene(DEFAULT_LAYERS, { ...PICK, filter: { ...ALL_PICKABLE, vias: false } }))).toBeUndefined()
    expect(hoverTarget(p(0, 0), pcbScene(DEFAULT_LAYERS, { ...PICK, armed: "note" }))).toBeUndefined()
  })

  test("a designator under the pointer takes the click, so the copper under it gets no label", () => {
    expect(hoverTarget(p(4, 5), { ...pcbScene(), texts: { at: () => "U1:pcbNameAt" } })).toBeUndefined()
  })

  test("the label names what a click picks: copper first, then the pad's part", () => {
    const scene = pcbScene()
    for (const at of [p(0.1, 0.1), p(2, 0), p(10, 0), p(20, 0.1), p(4, 5.05), p(4, 8), p(0, 5)]) {
      const label = hoverTarget(at, scene)
      const copper = copperAt(scene.copper, at, scene.scale, scene.layers.visible, scene.context)
      if (copper) {
        expect(label).toMatchObject({ kind: copper.kind, id: copper.id })
        continue
      }
      const clicked = targetAt(scene.boxes, undefined, at, scene.context)
      const under = padAt(scene.design.pcb, at, scene.layers.visible)
      expect(label).toMatchObject({ kind: "pad", id: under?.id })
      expect(clicked).toEqual({ kind: "part", name: under?.component })
    }
  })
})

const label = (id: string, net: string, text: string, at: Point, style: NetLabel["style"] = "label"): NetLabel => ({ id, net, text, at, side: "left", style })

function sheetScene(context: PickContext = PICK): SheetHoverScene {
  const labels = [label("L1", "net.V3_3", "V3_3", p(0, 5)), label("G1", "net.GND", "GND", p(10, 5), "ground")]
  const wires = [{ id: "W1", net: "net.V3_3", points: [p(-5, 10), p(5, 10)] }]
  return {
    view: "schematic",
    design: {
      circuit: CIRCUIT,
      schematic: {
        symbols: [
          { component: "U1", pinEnds: { "U1.pin5": p(1, 0), "U1.pin1": p(-1, 0) } },
          { component: "PS1", pinEnds: { "PS1.VIN": p(20, 0), "PS1.D": p(22, 0) } },
        ],
        wires,
        labels,
      },
    } as unknown as SheetHoverScene["design"],
    scale: 100,
    context,
    boxes: [box("U1", -1, 1), box("PS1", 20, 22)],
    labels: { at: (world) => labels.find((one) => Math.hypot(world.x - one.at.x, world.y - one.at.y) < 0.1) },
    wires: { at: (world) => (Math.abs(world.y - 10) < 0.05 && Math.abs(world.x) <= 5 ? "W1" : undefined) },
  }
}

describe("hover labels on the schematic", () => {
  test("a pin end names the part, the pin's own name and its net", () => {
    expect(hoverTarget(p(1.05, 0), sheetScene())).toEqual({ kind: "pin", id: "U1.pin5", text: "U1.VOUT · V3_3" })
    expect(hoverTarget(p(-1, 0.05), sheetScene())?.text).toBe("U1.pin1 · no net")
  })

  test("a net label or a power flag says its net; a wire says it is a wire and its net", () => {
    expect(hoverTarget(p(0, 5), sheetScene())).toEqual({ kind: "label", id: "L1", text: "V3_3" })
    expect(hoverTarget(p(10, 5), sheetScene())?.text).toBe("GND")
    expect(hoverTarget(p(0, 10), sheetScene())).toEqual({ kind: "wire", id: "W1", text: "wire · V3_3" })
  })

  test("a sheet symbol's pin says the net it joins; a bus pin the bus", () => {
    expect(hoverTarget(p(20, 0.05), sheetScene())).toEqual({ kind: "port", id: "PS1.VIN", text: "PS1.VIN · VBUS" })
    expect(hoverTarget(p(22, 0), sheetScene())?.text).toBe("PS1.D · bus D[0:7]")
  })

  test("a symbol's body away from its pins, or the empty sheet, has no label", () => {
    expect(hoverTarget(p(0, 1.5), sheetScene())).toBeUndefined()
    expect(hoverTarget(p(40, 40), sheetScene())).toBeUndefined()
  })

  test("the label names what a click picks: a label or wire over a pin is the label or wire", () => {
    const scene = sheetScene()
    for (const at of [p(0, 5), p(0, 10), p(1.05, 0), p(20, 0), p(0, 1.5)]) {
      const clicked = targetAt(scene.boxes, scene.labels, at, scene.context, scene.wires)
      const shown = hoverTarget(at, scene)
      if (clicked.kind === "label") expect(shown).toMatchObject({ kind: "label", id: clicked.label.id })
      else if (clicked.kind === "wire") expect(shown).toMatchObject({ kind: "wire", id: clicked.id })
      else expect(shown === undefined || shown.kind === "pin" || shown.kind === "port").toBe(true)
    }
  })

  test("with the note tool armed, or parts filtered out, a pin has no label", () => {
    expect(hoverTarget(p(1, 0), sheetScene({ ...PICK, armed: "note" }))).toBeUndefined()
    expect(hoverTarget(p(1, 0), sheetScene({ ...PICK, filter: { ...ALL_PICKABLE, parts: false } }))).toBeUndefined()
  })
})
