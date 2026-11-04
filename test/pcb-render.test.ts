import { describe, expect, test } from "vitest"
import { buildNets, padAt } from "../studio/src/pcb/nets.js"
import { drawPcb, SUPPORTED_TYPES } from "../studio/src/pcb/render.js"

/** A 2D context that records what was drawn. */
function recorder() {
  const calls: string[] = []
  const ctx = new Proxy(
    { fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1, lineCap: "", lineJoin: "" },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        return (...args: unknown[]) => {
          calls.push(String(key))
          if (key === "measureText") return { width: 10 }
          return undefined
        }
      },
      set(target, key, value) {
        ;(target as Record<string, unknown>)[key as string] = value
        return true
      },
    },
  )
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }

const JSON_ = [
  { type: "pcb_board", center: { x: 0, y: 0 }, width: 30, height: 18 },
  { type: "source_port", source_port_id: "sp1", name: "pin1" },
  { type: "source_port", source_port_id: "sp2", name: "pin1" },
  { type: "source_port", source_port_id: "sp3", name: "pin2" },
  { type: "source_trace", source_trace_id: "st1", connected_source_port_ids: ["sp1", "sp2"], connected_source_net_ids: [] },
  { type: "pcb_port", pcb_port_id: "pp1", source_port_id: "sp1", x: -5, y: 4 },
  { type: "pcb_port", pcb_port_id: "pp2", source_port_id: "sp2", x: 5, y: 4 },
  { type: "pcb_port", pcb_port_id: "pp3", source_port_id: "sp3", x: 5, y: -4 },
  { type: "pcb_smtpad", shape: "rect", x: -5, y: 4, width: 0.6, height: 0.8, layer: "top", pcb_port_id: "pp1" },
  { type: "pcb_smtpad", shape: "pill", x: 5, y: 4, width: 0.6, height: 1.2, radius: 0.3, layer: "top", pcb_port_id: "pp2" },
  { type: "pcb_smtpad", shape: "circle", x: 5, y: -4, radius: 0.4, layer: "bottom", pcb_port_id: "pp3" },
  {
    type: "pcb_trace",
    pcb_trace_id: "pt1",
    source_trace_id: "st1",
    route: [
      { route_type: "wire", x: -5, y: 4, width: 0.2, layer: "top" },
      { route_type: "wire", x: 5, y: 4, width: 0.2, layer: "top" },
    ],
  },
  { type: "pcb_plated_hole", shape: "circle", x: 0, y: 0, outer_diameter: 1.5, hole_diameter: 1, layers: ["top", "bottom"] },
  { type: "pcb_via", x: 1, y: 1, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] },
  { type: "pcb_silkscreen_path", layer: "top", route: [{ x: 0, y: 0 }, { x: 1, y: 0 }], stroke_width: 0.12 },
  { type: "pcb_silkscreen_text", layer: "top", text: "R1", font_size: 0.4, anchor_position: { x: 0, y: 1 }, anchor_alignment: "center", ccw_rotation: 0 },
  { type: "pcb_courtyard_rect", layer: "top", center: { x: 0, y: 0 }, width: 2, height: 1 },
  { type: "pcb_copper_pour", layer: "top" },
]

describe("nets", () => {
  test("pads and traces on the same source trace share a net", () => {
    const nets = buildNets(JSON_)
    expect(nets.ofPort("pp1")).toBe(nets.ofPort("pp2"))
    expect(nets.ofTrace("pt1")).toBe(nets.ofPort("pp1"))
    expect(nets.ofPort("pp3")).not.toBe(nets.ofPort("pp1"))
  })

  test("padAt finds the pad under a point, by shape", () => {
    expect(padAt(JSON_, { x: -5.2, y: 4.3 })).toBe("pp1")
    expect(padAt(JSON_, { x: 5, y: -4.35 })).toBe("pp3")
    expect(padAt(JSON_, { x: 5, y: -4.5 })).toBeUndefined()
  })
})

describe("drawPcb", () => {
  test("draws every supported element and reports the rest", () => {
    const { ctx, calls } = recorder()
    const result = drawPcb(ctx, JSON_, VIEW, { ratio: 1 })
    expect(result.unsupported).toEqual(["pcb_copper_pour"])
    expect(calls.filter((c) => c === "fill").length).toBeGreaterThan(5)
    expect(calls).toContain("fillText")
  })

  test("hidden layers are not drawn", () => {
    const all = recorder()
    drawPcb(all.ctx, JSON_, VIEW, { ratio: 1 })
    const noSilk = recorder()
    drawPcb(noSilk.ctx, JSON_, VIEW, { ratio: 1, layers: { silkscreen: false } })
    expect(noSilk.calls).not.toContain("fillText")
    expect(noSilk.calls.length).toBeLessThan(all.calls.length)
  })

  test("the supported list covers what a routed board uses", () => {
    for (const type of ["pcb_board", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_via", "pcb_trace", "pcb_silkscreen_text"]) {
      expect(SUPPORTED_TYPES.has(type)).toBe(true)
    }
  })
})
