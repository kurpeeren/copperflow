import { describe, expect, test } from "vitest"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { routeTargetAt, type TargetSource } from "../studio/src/pcb/track-targets.js"

const p = (x: number, y: number) => ({ x, y })
const pad = (id: string, at: { x: number; y: number }, net: string, layers: "top" | "bottom" | "through" = "top") => ({
  id,
  number: id.split("#")[1] ?? "1",
  shape: "rect" as const,
  x: at.x,
  y: at.y,
  width: 1,
  height: 1,
  rotation: 0,
  layers,
  component: id.split("#")[0] as string,
  pin: `${id.split("#")[0]}.pin${id.split("#")[1]}`,
  net,
})

const source = (): TargetSource => ({
  design: {
    circuit: {
      components: [{ id: "U1", pins: [{ id: "U1.pin1", names: ["pin1", "VIN"] }] }, { id: "C1", pins: [{ id: "C1.pin1", names: ["pin1"] }] }],
      nets: [
        { id: "net.VBUS", names: ["VBUS"], pins: [] },
        { id: "net.GND", names: ["GND"], pins: [] },
      ],
    },
    pcb: { parts: [{ component: "U1", pads: [pad("U1#1", p(0, 0), "net.VBUS")] }, { component: "C1", pads: [pad("C1#1", p(20, 0), "net.GND", "through")] }] },
  } as unknown as TargetSource["design"],
  copper: {
    tracks: [{ id: "t0001", net: "net.VBUS", layer: "top", width: 0.25, points: [p(5, 5), p(15, 5)] }],
    vias: [{ id: "v0001", net: "net.GND", at: p(10, 10), diameter: 0.6 }],
  },
  visible: DEFAULT_LAYERS,
})

describe("routeTargetAt", () => {
  test("a pad, labelled by its pin's own name, on its net and layer", () => {
    expect(routeTargetAt(source(), p(0.2, 0.1), 0.3, "top")).toEqual({ kind: "pad", id: "U1#1", label: "U1.VIN", part: "U1", at: p(0, 0), net: "net.VBUS", netName: "VBUS", layer: "top" })
    expect(routeTargetAt(source(), p(20, 0), 0.3, "top")).toMatchObject({ kind: "pad", label: "C1.pin1", layer: "through", netName: "GND" })
  })

  test("a via comes first, then a pad, then a track on the route's layer met at the nearest point, on the grid", () => {
    expect(routeTargetAt(source(), p(10.2, 10), 0.3, "top")).toEqual({ kind: "via", id: "v0001", at: p(10, 10), net: "net.GND", netName: "GND" })
    expect(routeTargetAt(source(), p(7.3, 5.2), 0.3, "top", { step: 1, snap: true })).toEqual({ kind: "track", id: "t0001", at: p(7, 5), net: "net.VBUS", netName: "VBUS", layer: "top" })
    expect(routeTargetAt(source(), p(7.3, 5.2), 0.3, "top", { step: 1, snap: false })).toMatchObject({ at: p(7.3, 5) })
  })

  test("a track on the other layer, or on a hidden layer, is not a target; with no layer given any shown track is", () => {
    expect(routeTargetAt(source(), p(7, 5.1), 0.3, "bottom")).toBeUndefined()
    expect(routeTargetAt({ ...source(), visible: { ...DEFAULT_LAYERS, top: false } }, p(7, 5.1), 0.3, undefined)).toBeUndefined()
    expect(routeTargetAt(source(), p(7, 5.1), 0.3, undefined)).toMatchObject({ kind: "track", id: "t0001" })
  })

  test("nothing in reach is no target", () => {
    expect(routeTargetAt(source(), p(30, 30), 0.3, "top")).toBeUndefined()
  })
})

describe("a pad within reach", () => {
  test("a click just off a pad's edge, within reach, still finds it; farther away it finds nothing", () => {
    // U1#1 is 1 × 1 at the origin, so its edge is 0.5 from its centre.
    expect(routeTargetAt(source(), p(0.7, 0.2), 0.3, "top")).toMatchObject({ kind: "pad", id: "U1#1", at: p(0, 0) })
    expect(routeTargetAt(source(), p(0.9, 0), 0.3, "top")).toBeUndefined()
  })

  test("a pad on a hidden layer is not found, even within reach", () => {
    const hidden = { ...source(), visible: { ...DEFAULT_LAYERS, top: false } }
    expect(routeTargetAt(hidden, p(0.1, 0.1), 0.3, "top")).toBeUndefined()
  })
})
