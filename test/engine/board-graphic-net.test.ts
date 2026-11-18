// A drawing on copper on a net (`<boardgraphic layer="top" net="GND">`): that net's copper everywhere. It joins the pads,
// tracks and vias of its net that it touches (their airwires go), keeps clear of every other net (touching one is a
// short), is an island when it touches nothing of its net, merges with a pour of its net and is cleared by others.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { copperDrawingLines } from "../../src/mcp/copper-summary.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"
/** A U 11 mm wide and 2 mm high: a 1 mm bar along the bottom and two 1 × 1 mm legs up at its ends. */
const U = `<svg xmlns="http://www.w3.org/2000/svg" width="11mm" height="2mm" viewBox="0 0 11 2"><path d="M0 0 H1 V1 H10 V0 H11 V2 H0 Z" fill="black"/></svg>`
/** A 2 × 2 mm square. */
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="2mm" viewBox="0 0 2 2"><rect x="0" y="0" width="2" height="2" fill="black"/></svg>`
const FILES = { "graphics/u.svg": U, "graphics/square.svg": SQUARE }

/** Two resistors turned upright, 10 mm apart: each one's lower pad is on LOW, its upper pad on HIGH. */
const circuit = (items: string) => `export default () => (<board width="24mm" height="14mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} pcbRotation={90} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} pcbRotation={90} />
    <trace from="R1.pin1" to="net.A" />
    <trace from="R2.pin1" to="net.A" />
    <trace from="R1.pin2" to="net.B" />
    <trace from="R2.pin2" to="net.B" />
    ${items}
  </board>)`
const build = (items: string, layout?: string): Design => buildDesign({ [MAIN]: circuit(items), ...FILES, ...(layout === undefined ? {} : { [LAYOUT]: layout }) }, MAIN)

const plain = build("")
const pads = plain.pcb.parts.flatMap((part) => part.pads)
const r1 = pads.filter((pad) => pad.id.startsWith("R1"))
const lower = [...r1].sort((a, b) => a.y - b.y)[0]!
const upper = [...r1].sort((a, b) => a.y - b.y)[1]!
const name = (net: string | undefined) => (net ?? "").replace(/^net[.:]/, "")
const LOW = name(lower.net)
const HIGH = name(upper.net)
/** The U's legs end on the centres of the lower pads. */
const uAt = (net: string, layer = "top") => `<boardgraphic file="graphics/u.svg" layer="${layer}" net="${net}" x={0} y={${lower.y - 1}} width={11} />`
const about = (design: Design) => design.violations.filter((v) => v.items.includes("boardgraphic:1"))
const track = (net: string, points: { x: number; y: number }[], id = "t0001") => `${JSON.stringify({ t: "track", id, net, layer: "top", width: 0.25, points, locked: false, by: "human" })}\n`

describe("connectivity", () => {
  test("the lower pads are on one net and need an airwire without the drawing", () => {
    expect(lower.x).toBeLessThan(0)
    expect(plain.pcb.ratsnest.filter((line) => name(line.net) === LOW)).toHaveLength(1)
  })

  test("a drawing on the lower pads' net joins them: their airwire goes, and nothing names the drawing", () => {
    const design = build(uAt(LOW))
    expect(design.diagnostics.filter((d) => d.message.includes("boardgraphic"))).toEqual([])
    expect(design.pcb.graphics?.[0]?.net).toBe(lower.net)
    expect(design.pcb.ratsnest.filter((line) => name(line.net) === LOW)).toEqual([])
    expect(design.pcb.ratsnest.filter((line) => name(line.net) === HIGH)).toHaveLength(1)
    expect(about(design)).toEqual([])
  })

  test("a track touching only the drawing is joined through it, not floating", () => {
    const stub = track(LOW, [{ x: 0, y: lower.y - 1.5 }, { x: 0, y: lower.y - 4 }])
    const design = build(uAt(LOW), stub)
    expect(design.diagnostics.filter((d) => d.code === "floating")).toEqual([])
    expect(design.pcb.tracks[0]?.net).toBe(lower.net)
  })

  test("a net the circuit does not have is refused with the nets it has; the drawing is left out", () => {
    const design = build(uAt("NOPE"))
    expect(design.pcb.graphics).toBeUndefined()
    const found = design.diagnostics.filter((d) => d.code === "drawing-net")
    expect(found.map((d) => d.severity)).toEqual(["error"])
    expect(found[0]?.message).toContain("names the net NOPE, which the circuit does not have")
    expect(found[0]?.message).toContain(`${LOW}, ${HIGH}`.split(", ").sort().join(", "))
  })

  test("a net on a drawing that is not on copper is refused", () => {
    const design = build(`<boardgraphic file="graphics/square.svg" layer="top-silkscreen" net="${LOW}" x={0} y={-5} width={2} />`)
    expect(design.pcb.graphics).toBeUndefined()
    expect(design.diagnostics.map((d) => d.message).join("\n")).toContain("net is only for a drawing on copper")
  })
})

describe("the checks", () => {
  test("touching another net's pads is a short naming both nets", () => {
    const found = about(build(uAt(HIGH)))
    const shorts = found.filter((v) => v.code === "short")
    expect(shorts.length).toBeGreaterThan(0)
    expect(shorts[0]?.message).toMatch(new RegExp(`^boardgraphic:1 of ${HIGH} touches the pad R\\d#\\d of ${LOW}: a short between ${HIGH} and ${LOW}`))
  })

  test("another net's track 0.05 mm away breaks the clearance; its own net's track on it is fine", () => {
    // The bar's top edge between the legs: the U spans 2 mm below the pads' centres, the bar its lower half.
    const top = lower.y - 1
    const near = about(build(uAt(LOW), track(HIGH, [{ x: -3, y: top + 0.175 }, { x: 3, y: top + 0.175 }])))
    expect(near.map((v) => v.code)).toEqual(["copper-clearance"])
    expect(near[0]?.message).toMatch(new RegExp(`^boardgraphic:1 is 0\\.050 mm from the track t0001 of ${HIGH}; `))
    expect(about(build(uAt(LOW), track(LOW, [{ x: -3, y: top - 0.5 }, { x: 3, y: top - 0.5 }])))).toEqual([])
  })

  test("a drawing on a net touching nothing of that net is an island", () => {
    const found = about(build(`<boardgraphic file="graphics/square.svg" layer="top" net="${LOW}" x={0} y={-5} width={2} />`))
    expect(found.map((v) => [v.code, v.severity])).toEqual([["drawing-floating", "warning"]])
    expect(found[0]?.message).toContain(`touches no copper of ${LOW}`)
    expect(found[0]?.message).toContain("island")
  })
})

describe("on an inner layer of a four-layer board", () => {
  const four = (items: string, layout: string): Design => buildDesign({ [MAIN]: circuit(items).replace('height="14mm">', 'height="14mm" layers={4}>'), ...FILES, [LAYOUT]: layout }, MAIN)
  const via = (net: string) => `${JSON.stringify({ t: "via", id: "v0001", net, at: { x: 0, y: -5 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" })}
`
  const square = `<boardgraphic file="graphics/square.svg" layer="inner1" net="${LOW}" x={0} y={-5} width={2} />`

  test("a through via of another net inside the drawing is a short", () => {
    const found = about(four(square, via(HIGH)))
    expect(found.map((v) => v.code)).toContain("short")
    expect(found.find((v) => v.code === "short")?.message).toMatch(new RegExp(`^boardgraphic:1 of ${LOW} touches the via v0001 of ${HIGH}`))
  })

  test("a through via of its own net joins it: it is no island", () => {
    expect(about(four(square, via(LOW))).map((v) => v.code)).toEqual([])
  })
})

describe("a pour", () => {
  const area = (design: Design) => design.pcb.pours.reduce((sum, fill) => sum + fill.area, 0)
  test("of the drawing's net merges with it; one of another net clears it", () => {
    const pour = (net: string) => `<copperpour net="${net}" layer="top" />`
    const same = build(`${uAt(LOW)}${pour(LOW)}`)
    const free = build(`<boardgraphic file="graphics/u.svg" layer="top" x={0} y={${lower.y - 1}} width={11} />${pour(LOW)}`)
    const other = build(`${uAt(LOW)}${pour(HIGH)}`)
    expect(about(same)).toEqual([])
    expect(about(other)).toEqual([])
    // Merged, the fill covers the drawing and its clearance ring; cleared, it does not.
    expect(area(same)).toBeGreaterThan(area(free) + 13)
    expect(area(other)).toBeLessThan(area(same) - 13)
    expect(same.violations.filter((v) => v.code === "pour-floating")).toEqual([])
  })
})

describe("copper_summary", () => {
  test("lists the drawing under its net", () => {
    const [line] = copperDrawingLines(build(uAt(LOW)))
    expect(line).toContain(`boardgraphic:1 graphics/u.svg top`)
    expect(line).toContain(`on ${LOW}`)
    expect(line).not.toContain("no net")
    expect(copperDrawingLines(build(`<boardgraphic file="graphics/u.svg" layer="top" x={0} y={-5} width={11} />`))[0]).toContain("no net")
  })
})

describe("drawings of one net that touch", () => {
  /** A 6 × 1 mm bar. */
  const BAR = `<svg xmlns="http://www.w3.org/2000/svg" width="6mm" height="1mm" viewBox="0 0 6 1"><rect width="6" height="1" fill="black"/></svg>`
  const bar = (x: number, width = 6) => `<boardgraphic file="graphics/bar.svg" layer="top" net="${LOW}" x={${x}} y={${lower.y}} width={${width}} />`
  const withBar = (items: string) => buildDesign({ [MAIN]: circuit(items), ...FILES, "graphics/bar.svg": BAR }, MAIN)

  test("join each other: one on each lower pad, meeting in the middle, leaves no airwire", () => {
    const design = withBar(`${bar(-3)}${bar(3)}`)
    expect(design.pcb.ratsnest.filter((line) => name(line.net) === LOW)).toEqual([])
    expect(design.violations.filter((v) => v.code === "drawing-floating")).toEqual([])
  })

  test("one touching only another that touches a pad is not an island", () => {
    const design = withBar(`${bar(-3)}${bar(2, 4)}`)
    expect(design.violations.filter((v) => v.code === "drawing-floating")).toEqual([])
  })
})

test("a drawing on a net touching a pad of no net is worded for its net", () => {
  const items = `<resistor name="R3" resistance="1k" footprint="0603" pcbX={0} pcbY={4} /><boardgraphic file="graphics/square.svg" layer="top" net="${LOW}" x={0} y={4} width={2} />`
  const found = about(build(items)).filter((v) => v.message.includes("R3"))
  expect(found.length).toBeGreaterThan(0)
  expect(found[0]?.message).toMatch(new RegExp(`^boardgraphic:1 of ${LOW} touches the pad R3#[0-9], which is on no net; copper of ${LOW} must stand clear of it`))
})
