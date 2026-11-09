import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import type { WorldPad } from "../../src/engine/pcb.js"

const MAIN = "boards/main.circuit.tsx"
const LAYOUT = "boards/main.circuit.layout.json"
const CIRCUIT = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={0} pcbY={6} />
    <trace from=".R1 > .pin1" to="net.SIG" />
    <trace from=".R2 > .pin1" to="net.SIG" />
    <trace from=".R3 > .pin1" to="net.SIG" />
    <trace from=".R1 > .pin2" to="net.GND" />
  </board>
)
`

const build = (layout?: string) => buildDesign({ [MAIN]: CIRCUIT, ...(layout === undefined ? {} : { [LAYOUT]: layout }) }, MAIN)
const padOf = (id: string): WorldPad => {
  const found = build().pcb.parts.flatMap((p) => p.pads).find((p) => p.id === id)
  if (!found) throw new Error(`no pad ${id}`)
  return found
}
const trackLine = (id: string, a: WorldPad, b: WorldPad, net = "SIG") =>
  `${JSON.stringify({ t: "track", id, net, layer: "top", width: 0.25, points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], locked: false, by: "human" })}\n`
const unrouted = (layout?: string) => build(layout).violations.find((v) => v.code === "unrouted")?.message

describe("the design reads the layout file", () => {
  test("without a layout file there is no copper", () => {
    const design = build()
    expect(design.pcb.tracks).toEqual([])
    expect(design.pcb.vias).toEqual([])
    expect(design.pcb.ratsnest).toHaveLength(2)
    expect(unrouted()).toBe("2 connections are not routed yet")
  })

  test("a track between two pads of the net carries it and its connection leaves the ratsnest", () => {
    const layout = trackLine("t0001", padOf("R1#1"), padOf("R2#1"))
    const design = build(layout)
    expect(design.pcb.tracks).toEqual([expect.objectContaining({ id: "t0001", net: "net.SIG", pads: ["R1#1", "R2#1"] })])
    expect(design.pcb.ratsnest).toHaveLength(1)
    expect(unrouted(layout)).toBe("1 connection is not routed yet")
  })

  test("a track joining two nets is a short among the violations, at the track, and not a diagnostic", () => {
    const a = padOf("R1#1")
    const design = build(trackLine("t0001", a, padOf("R1#2")))
    expect(design.violations.filter((v) => v.code === "short")).toEqual([
      expect.objectContaining({ id: "short:net.GND,net.SIG,t0001", severity: "error", items: ["net.GND", "net.SIG", "t0001"], view: "pcb", at: { x: a.x, y: a.y } }),
    ])
    expect(design.diagnostics.filter((d) => d.code === "short")).toEqual([])
  })

  test("floating copper and a named net the pads contradict are warnings among the violations", () => {
    const floating = `${JSON.stringify({ t: "via", id: "v0001", at: { x: 0, y: -6 }, drill: 0.3, diameter: 0.8, layers: ["top", "bottom"], locked: false, by: "human" })}\n`
    const design = build(floating + trackLine("t0001", padOf("R1#1"), padOf("R2#1"), "GND"))
    const found = design.violations.filter((v) => v.code === "floating" || v.code === "mismatch")
    expect(found.map((v) => [v.id, v.severity, v.at])).toEqual([
      ["floating:v0001", "warning", { x: 0, y: -6 }],
      ["mismatch:t0001", "warning", { x: padOf("R1#1").x, y: padOf("R1#1").y }],
    ])
    expect(design.diagnostics.filter((d) => d.code === "floating" || d.code === "mismatch")).toEqual([])
  })

  test("a floating track crossing a GND track and a SIG track mid-segment is a short error", () => {
    const [gnd, sig] = [padOf("R1#2"), padOf("R2#1")]
    const up = (id: string, p: WorldPad, net: string) => trackLine(id, p, { ...p, y: p.y - 3 } as WorldPad, net)
    const bridge = trackLine("t0003", { ...gnd, x: gnd.x - 1, y: gnd.y - 2 } as WorldPad, { ...sig, x: sig.x + 1, y: sig.y - 2 } as WorldPad)
    const design = build(up("t0001", gnd, "GND") + up("t0002", sig, "SIG") + bridge.replace(',"net":"SIG"', ""))
    expect(design.violations.filter((v) => v.code === "short").map((v) => [v.severity, v.items])).toEqual([
      ["error", ["net.GND", "net.SIG", "t0001", "t0002", "t0003"]],
    ])
  })

  test("a SIG track ending on a pad with no net is a clearance error", () => {
    const design = build(trackLine("t0001", padOf("R1#1"), padOf("R3#2")))
    expect(design.violations.filter((v) => v.code === "copper-clearance").map((v) => v.id)).toEqual(["copper-clearance:R3#2|t0001"])
  })

  test("copper too close to a pad of another net is a clearance violation of the design", () => {
    const r3 = padOf("R3#2")
    const near = `${JSON.stringify({ t: "track", id: "t0001", net: "SIG", layer: "top", width: 0.25, points: [{ x: r3.x - 2, y: r3.y + r3.height / 2 + 0.225 }, { x: r3.x + 2, y: r3.y + r3.height / 2 + 0.225 }], locked: false, by: "human" })}\n`
    const design = build(trackLine("t0002", padOf("R1#1"), padOf("R3#1")) + near)
    expect(design.violations.map((v) => v.id)).toContain("copper-clearance:R3#2|t0001")
  })

  test("a bad line in the layout file is an error naming the file, and the good lines still count", () => {
    const design = build(`not json\n${trackLine("t0001", padOf("R1#1"), padOf("R2#1"))}`)
    expect(design.diagnostics.filter((d) => d.code === "layout-file").map((d) => d.message)).toEqual([`${LAYOUT}: line 1 is not valid JSON`])
    expect(design.pcb.tracks).toHaveLength(1)
  })

  test("the same files build the same copper", () => {
    const layout = trackLine("t0002", padOf("R2#1"), padOf("R3#1")) + trackLine("t0001", padOf("R1#1"), padOf("R2#1"))
    expect(JSON.stringify(build(layout).pcb)).toBe(JSON.stringify(build(layout).pcb))
    expect(build(layout).pcb.tracks.map((t) => t.id)).toEqual(["t0002", "t0001"])
    expect(build(layout).pcb.ratsnest).toEqual([])
  })
})
