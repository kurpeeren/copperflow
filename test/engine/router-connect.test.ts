import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import type { PcbLayout } from "../../src/engine/pcb.js"
import { checkRouted, layoutLines, routeIn } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"
const BLOCK = "parts/block/footprint.yaml"
const BLOCK_YAML = "pads:\n  - { number: '1', shape: rect, x: 0, y: 0, width: 2, height: 10 }\n"

const board = (width: number, height: number, body: string) => `export default () => (
  <board width="${width}mm" height="${height}mm">
${body}
  </board>
)
`
const resistor = (name: string, x: number, y: number, extra = "") => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
const trace = (from: string, net: string) => `    <trace from="${from}" to="net.${net}" />`

const padAt = (layout: PcbLayout, id: string) => {
  const pad = layout.parts.flatMap((part) => part.pads).find((p) => p.id === id)
  if (pad === undefined) throw new Error(`no pad ${id}`)
  return pad
}
const sigLines = (layout: PcbLayout) => layout.ratsnest.filter((line) => line.net === "net.SIG")

describe("routing one connection", () => {
  const AROUND = {
    [MAIN]: board(30, 16, [
      resistor("R1", -9, 0),
      resistor("R2", 9, 0),
      `    <chip name="U1" footprint="${BLOCK}" pinCount={1} pcbX={0} pcbY={0} />`,
      trace("R1.pin2", "SIG"),
      trace("R2.pin1", "SIG"),
      trace("U1.pin1", "OTHER"),
    ].join("\n")),
    [BLOCK]: BLOCK_YAML,
  }

  test("a part in the way is gone round on the same layer, and the result passes every check", () => {
    const design = buildDesign(AROUND, MAIN)
    const result = routeIn(design, "R1#2", "R2#1")
    expect(result.routed).toBe(true)
    if (!result.routed) return
    expect(result.copper.vias).toEqual([])
    expect(result.copper.tracks.every((track) => track.layer === "top" && track.width === 0.25)).toBe(true)
    const reach = Math.max(...result.copper.tracks.flatMap((track) => track.points.map((p) => Math.abs(p.y))))
    expect(reach).toBeGreaterThan(5)
    const checked = checkRouted(AROUND, MAIN, result.copper)
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
    expect(sigLines(checked.before.pcb)).toHaveLength(1)
    expect(sigLines(checked.after.pcb)).toEqual([])
    expect(checked.after.pcb.tracks.every((track) => track.net === "net.SIG")).toBe(true)
  })

  test("the same board gives the same route", () => {
    const design = buildDesign(AROUND, MAIN)
    expect(routeIn(design, "R1#2", "R2#1")).toEqual(routeIn(design, "R1#2", "R2#1"))
  })

  test("a pad on the other side is reached through one via", () => {
    const files = { [MAIN]: board(20, 10, [resistor("R1", -5, 0), resistor("R2", 5, 0, `layer="bottom" `), trace("R1.pin2", "SIG"), trace("R2.pin1", "SIG")].join("\n")) }
    const result = routeIn(buildDesign(files, MAIN), "R1#2", "R2#1")
    expect(result.routed).toBe(true)
    if (!result.routed) return
    expect(result.copper.vias).toEqual([{ at: expect.any(Object), drill: 0.3, diameter: 0.66, layers: ["top", "bottom"] }])
    expect(result.copper.tracks.map((track) => track.layer)).toEqual(["top", "bottom"])
    const checked = checkRouted(files, MAIN, result.copper)
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
    expect(sigLines(checked.after.pcb)).toEqual([])
  })

  test("a connection may end on a track of its net instead of the pad", () => {
    const body = [resistor("R1", -6, 0), resistor("R2", 6, 4), resistor("R3", 6, -4), trace("R1.pin2", "SIG"), trace("R2.pin1", "SIG"), trace("R3.pin1", "SIG")].join("\n")
    const bare = { [MAIN]: board(20, 14, body) }
    const plain = buildDesign(bare, MAIN).pcb
    const [top, bottom] = [padAt(plain, "R2#1"), padAt(plain, "R3#1")]
    const hand = { t: "track", id: "t0001", net: "SIG", layer: "top", width: 0.25, points: [{ x: top.x, y: top.y }, { x: bottom.x, y: bottom.y }], locked: false, by: "human" }
    const files = { ...bare, [LAYOUT]: `${JSON.stringify(hand)}\n` }
    const design = buildDesign(files, MAIN)
    const line = sigLines(design.pcb)[0]
    expect(line && [line.from, line.to].sort()).toEqual(["R1#2", "R2#1"])
    const result = routeIn(design, "R1#2", "R3#1")
    expect(result.routed).toBe(true)
    if (!result.routed) return
    const end = result.copper.tracks.at(-1)?.points.at(-1)
    expect(Math.abs((end?.x ?? 99) - top.x)).toBeLessThanOrEqual(0.125)
    expect(Math.abs(end?.y ?? 99)).toBeLessThan(Math.abs(top.y) - 0.5)
    const checked = checkRouted(files, MAIN, result.copper, 2)
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
    expect(sigLines(checked.after.pcb)).toEqual([])
  })

  test("with no way across, nothing is laid and the reason names the keepout that closes it", () => {
    const files = { [MAIN]: board(20, 10, [resistor("R1", -5, 0), resistor("R2", 5, 0), `    <keepout pcbX={0} pcbY={0} width={1} height={12} />`, trace("R1.pin2", "SIG"), trace("R2.pin1", "SIG")].join("\n")) }
    expect(routeIn(buildDesign(files, MAIN), "R1#2", "R2#1")).toEqual({
      routed: false,
      reason: "could not route R1.pin2 to R2.pin1: no way past keepout:1",
      blockers: ["keepout:1"],
    })
  })

  test("with both layers crossed by other nets' copper, the reason names each track", () => {
    const body = [resistor("R1", -5, 0), resistor("R2", 5, 0), resistor("R3", 0, 4), trace("R1.pin2", "SIG"), trace("R2.pin1", "SIG"), trace("R3.pin1", "GND")].join("\n")
    const wall = (id: string, layer: string) => ({ t: "track", id, net: "GND", layer, width: 0.25, points: [{ x: 0, y: -5 }, { x: 0, y: 5 }], locked: false, by: "human" })
    const files = { [MAIN]: board(20, 10, body), [LAYOUT]: [wall("t0001", "top"), wall("t0002", "bottom")].map((r) => `${JSON.stringify(r)}\n`).join("") }
    const result = routeIn(buildDesign(files, MAIN), "R1#2", "R2#1")
    expect(result).toEqual({ routed: false, reason: "could not route R1.pin2 to R2.pin1: no room between t0001 and t0002", blockers: ["t0001", "t0002"] })
  })

  test("pads that are missing, on two nets or already joined are refused with a reason", () => {
    const design = buildDesign(AROUND, MAIN)
    expect(routeIn(design, "R1#2", "R9#1")).toEqual({ routed: false, reason: "no pad R9#1", blockers: [] })
    expect(routeIn(design, "R1#2", "U1#1")).toMatchObject({ routed: false, reason: "R1.pin2 and U1.pin1 are not on one net" })
    const result = routeIn(design, "R1#2", "R2#1")
    if (!result.routed) throw new Error(result.reason)
    const joined = buildDesign({ ...AROUND, [LAYOUT]: layoutLines(result.copper) }, MAIN)
    expect(routeIn(joined, "R1#2", "R2#1")).toMatchObject({ routed: false, reason: "R1.pin2 and R2.pin1 are already connected" })
  })
})

describe("pads no grid cell lies on", () => {
  const FINE = "parts/fine/footprint.yaml"
  const FINE_YAML = ["pads:", ...[-0.65, 0, 0.65].map((x, i) => `  - { number: '${i + 1}', shape: rect, x: ${x}, y: 0, width: 0.4, height: 1.5 }`)].join("\n") + "\n"
  const fine = (extra = "") => ({
    [MAIN]: board(20, 12, [
      `    <chip name="U1" footprint="${FINE}" pinCount={3} pcbX={0.125} pcbY={0} />`,
      resistor("R1", 0, -4),
      trace("U1.pin1", "A"),
      trace("U1.pin2", "SIG"),
      trace("U1.pin3", "B"),
      trace("R1.pin1", "SIG"),
      extra,
    ].join("\n")),
    [FINE]: FINE_YAML,
  })

  test("a fine-pitch pad off the grid is left from its centre, and the result passes every check", () => {
    const files = fine()
    const design = buildDesign(files, MAIN)
    const result = routeIn(design, "U1#2", "R1#1")
    if (!result.routed) throw new Error(result.reason)
    const pad = padAt(design.pcb, "U1#2")
    const ends = result.copper.tracks.flatMap((track) => [track.points[0], track.points.at(-1)])
    expect(ends).toContainEqual({ x: pad.x, y: pad.y })
    const checked = checkRouted(files, MAIN, result.copper)
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
  })

  test("with no legal way off the pad, the reason names what blocks its cells", () => {
    const files = fine(`    <keepout pcbX={0.125} pcbY={0} width={6} height={6} />`)
    const result = routeIn(buildDesign(files, MAIN), "U1#2", "R1#1")
    expect(result).toEqual({ routed: false, reason: "could not route U1.pin2 to R1.pin1: U1.pin2 has no free grid cell, blocked by U1#1 and U1#3", blockers: ["U1#1", "U1#3"] })
  })
})
