import { describe, expect, test } from "vitest"
import { parseLayout } from "../../src/core/layout-file.js"
import { applyLayoutRecordEdits } from "../../src/core/layout-records.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import type { Point } from "../../src/engine/model.js"
import { cleanup, layoutEdits } from "../../src/engine/router/cleanup.js"
import { netRule } from "../../src/engine/router/connect.js"
import type { RoutedCopper } from "../../src/engine/router/path.js"
import type { RoutedConnection } from "../../src/engine/router/route-board.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"

const board = (width: number, height: number, body: readonly string[]) => `export default () => (
  <board width="${width}mm" height="${height}mm">
${body.join("\n")}
  </board>
)
`
const resistor = (name: string, x: number, y: number) => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} />`
const trace = (from: string, net: string) => `    <trace from="${from}" to="net.${net}" />`
const keepout = (x: number, y: number, width: number, height: number) => `    <keepout pcbX={${x}} pcbY={${y}} width={${width}} height={${height}} />`

const inputOf = (design: Design) => ({ layout: design.pcb, rules: design.rules, nets: design.circuit.nets })

/** A two-resistor board with net A from R1.pin2 to R2.pin1, and the two pad centres. */
function pair(r2y = 0, extra: readonly string[] = []) {
  const files = { [MAIN]: board(20, 12, [resistor("R1", -5, 0), resistor("R2", 5, r2y), trace("R1.pin2", "A"), trace("R2.pin1", "A"), ...extra]) }
  const design = buildDesign(files, MAIN)
  const pads = design.pcb.parts.flatMap((part) => part.pads)
  const pad = (id: string) => pads.find((p) => p.id === id) as (typeof pads)[number]
  const line = design.pcb.ratsnest[0] as (typeof design.pcb.ratsnest)[number]
  const [first, second] = [pad(line.from), pad(line.to)]
  const [from, to] = first.x < second.x ? [first, second] : [second, first]
  const width = netRule(design.rules, design.circuit.nets, "net.A").width
  const route = (copper: RoutedCopper): RoutedConnection => ({ net: "net.A", from: from.id, to: to.id, copper })
  return { files, design, from, to, width, route, p1: { x: from.x, y: from.y }, p2: { x: to.x, y: to.y } }
}
const length = (points: readonly Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y), 0)
const octilinear = (a: Point, b: Point) => {
  const [dx, dy] = [Math.abs(b.x - a.x), Math.abs(b.y - a.y)]
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6
}

function expectClean(files: Record<string, string>, routed: readonly RoutedConnection[]) {
  const checked = checkRoutedAll(files, MAIN, routed.map((r) => r.copper))
  expect(checked.copper).toEqual([])
  expect(checked.added).toEqual([])
  expect(checked.after.pcb.ratsnest).toEqual([])
}

describe("cleaning up routed copper", () => {
  test("points on a straight line and a needless detour are removed", () => {
    const { files, design, p1, p2, width, route } = pair()
    const copper: RoutedCopper = { net: "net.A", vias: [], tracks: [{ layer: "top", width, points: [p1, { x: -2, y: 0 }, { x: -2, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }, { x: 0, y: 0 }, p2] }] }
    const cleaned = cleanup(inputOf(design), [route(copper)])
    expect(cleaned[0]?.copper.tracks).toEqual([{ layer: "top", width, points: [p1, p2] }])
    expectClean(files, cleaned)
  })

  test("a staircase becomes a 45° run", () => {
    const { files, design, p1, p2, width, route } = pair(4)
    const points: Point[] = [p1]
    let at = { ...p1 }
    for (let k = 0; k < 8; k++) {
      at = { x: at.x + 0.5, y: at.y }
      points.push(at)
      at = { x: at.x, y: at.y + 0.5 }
      points.push(at)
    }
    points.push(p2)
    const cleaned = cleanup(inputOf(design), [route({ net: "net.A", vias: [], tracks: [{ layer: "top", width, points }] })])
    const out = cleaned[0]?.copper.tracks[0]?.points ?? []
    expect(out.length).toBeLessThanOrEqual(4)
    expect(out[0]).toEqual(p1)
    expect(out.at(-1)).toEqual(p2)
    out.slice(1).forEach((p, i) => expect(octilinear(out[i] as Point, p)).toBe(true))
    expect(out.slice(1).some((p, i) => Math.abs(p.x - (out[i] as Point).x) > 1e-6 && Math.abs(p.y - (out[i] as Point).y) > 1e-6)).toBe(true)
    expect(length(out)).toBeLessThan(length(points))
    expectClean(files, cleaned)
  })

  test("vias are removed where the path fits on one layer", () => {
    const { files, design, p1, p2, width, route } = pair()
    const rule = netRule(design.rules, design.circuit.nets, "net.A")
    const via = (x: number) => ({ at: { x, y: 0 }, drill: rule.via.drill, diameter: rule.via.diameter, layers: ["top" as const, "bottom" as const] })
    const copper: RoutedCopper = {
      net: "net.A",
      tracks: [
        { layer: "top", width, points: [p1, { x: -2, y: 0 }] },
        { layer: "bottom", width, points: [{ x: -2, y: 0 }, { x: 2, y: 0 }] },
        { layer: "top", width, points: [{ x: 2, y: 0 }, p2] },
      ],
      vias: [via(-2), via(2)],
    }
    const cleaned = cleanup(inputOf(design), [route(copper)])
    expect(cleaned[0]?.copper).toEqual({ net: "net.A", vias: [], tracks: [{ layer: "top", width, points: [p1, p2] }] })
    expectClean(files, cleaned)
  })

  test("a track end inside its pad is snapped to the pad centre", () => {
    const { files, design, p1, p2, width, route } = pair()
    const copper: RoutedCopper = { net: "net.A", vias: [], tracks: [{ layer: "top", width, points: [{ x: p1.x + 0.2, y: p1.y }, { x: p2.x - 0.2, y: p2.y }] }] }
    const cleaned = cleanup(inputOf(design), [route(copper)])
    expect(cleaned[0]?.copper.tracks[0]?.points).toEqual([p1, p2])
    expectClean(files, cleaned)
  })

  test("a change that would break a rule is not made", () => {
    const { files, design, p1, p2, width, route } = pair(0, [keepout(0, 0, 2, 2)])
    const points = [p1, { x: -2, y: 0 }, { x: -2, y: 2.5 }, { x: 2, y: 2.5 }, { x: 2, y: 0 }, p2]
    const cleaned = cleanup(inputOf(design), [route({ net: "net.A", vias: [], tracks: [{ layer: "top", width, points }] })])
    const out = cleaned[0]?.copper.tracks[0]?.points ?? []
    expect(out.length).toBeGreaterThan(2)
    expect(length(out)).toBeLessThan(length(points))
    expectClean(files, cleaned)
  })

  test("the output is addTrack and addVia edits in one list, made by the router", () => {
    const { design, p1, p2, width, route } = pair()
    const rule = netRule(design.rules, design.circuit.nets, "net.A")
    const copper: RoutedCopper = { net: "net.A", tracks: [{ layer: "top", width, points: [p1, p2] }], vias: [{ at: { x: 8, y: 4 }, drill: rule.via.drill, diameter: rule.via.diameter, layers: ["top", "bottom"] }] }
    const edits = layoutEdits([route(copper)])
    expect(edits.map((edit) => edit.kind)).toEqual(["addTrack", "addVia"])
    const { doc } = applyLayoutRecordEdits(parseLayout(""), edits, { author: "ai", router: true })
    expect(doc.records.map((record) => record.by)).toEqual(["router", "router"])
  })
})

describe("cleaning up a routed board", () => {
  const CROSS = {
    [MAIN]: board(14, 12, [
      resistor("R1", -5.5, 0),
      resistor("R2", 5.5, 0),
      `    <resistor name="R3" resistance="1k" footprint="0603" pcbX={0} pcbY={-4.5} pcbRotation={90} />`,
      `    <resistor name="R4" resistance="1k" footprint="0603" pcbX={0} pcbY={4.5} pcbRotation={90} />`,
      trace("R1.pin2", "A"),
      trace("R2.pin1", "A"),
      trace("R3.pin2", "B"),
      trace("R4.pin1", "B"),
    ]),
  }

  test("the cleaned board passes every check, and cleanup is deterministic and idempotent", () => {
    const design = buildDesign(CROSS, MAIN)
    const report = routeDesign(design)
    expect(report.unrouted).toEqual([])
    expectClean(CROSS, report.routed)
    const again = cleanup(inputOf(design), report.routed)
    expect(again).toEqual(report.routed)
    expect(cleanup(inputOf(design), again)).toEqual(again)
    expect(report.edits).toEqual(layoutEdits(report.routed))
  }, 30_000)
})
