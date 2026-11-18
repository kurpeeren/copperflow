// The router round a drawing on copper on a real board: examples/can-node unrouted, a 1.6 mm copper square placed in
// the channel its routed tracks ran (the midpoint of its longest track segment that a square fits on, clear of every
// pad), the board routed again. Every connection is routed or reported unrouted, no copper of another net comes nearer
// the square than the clearance (measured with the checks' own distance), and the check names the square only as the
// rules allow. Done with the square of no net, then on GND, where GND copper may touch it.
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { checkDesign } from "../../src/core/check.js"
import { padShape, shapeDistance, type Shape } from "../../src/engine/checks/geometry.js"
import { breaksMinimum } from "../../src/engine/checks/limits.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import type { Point } from "../../src/engine/model.js"
import { requiredClearance } from "../../src/engine/rules/classes.js"
import { classLookup } from "../../src/engine/router/connect.js"
import { filesIn } from "../helpers/place-fixtures.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const FOLDER = fileURLToPath(new URL("../../examples/can-node", import.meta.url))
const MAIN = "can-node.circuit.tsx"
const LAYOUT = "can-node.circuit.layout.json"
const SIDE = 1.6
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDE}mm" height="${SIDE}mm" viewBox="0 0 ${SIDE} ${SIDE}"><rect width="${SIDE}" height="${SIDE}" fill="black"/></svg>`
/** How much more than the clearance the square keeps from every pad and the board edge where it is put. */
const ROOM = 0.6

const original = filesIn(FOLDER)
const routedBefore = buildDesign(original, MAIN)
const square = (at: Point): Shape => {
  const h = SIDE / 2
  return { core: [{ x: at.x - h, y: at.y - h }, { x: at.x + h, y: at.y - h }, { x: at.x + h, y: at.y + h }, { x: at.x - h, y: at.y + h }], radius: 0 }
}

/** The midpoint of the longest top-layer track segment where the square stands clear of every pad and inside the board. */
function channel(design: Design): Point {
  const pads = design.pcb.parts.flatMap((part) => part.pads).flatMap((pad) => padShape(pad) ?? [])
  const outline = design.pcb.board?.outline ?? []
  const [xs, ys] = [outline.map((p) => p.x), outline.map((p) => p.y)]
  const segments = design.pcb.tracks
    .filter((track) => track.layer === "top")
    .flatMap((track) => track.points.slice(1).map((p, i) => [track.points[i] as Point, p] as const))
    .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y))
  const margin = design.rules.fabrication.minClearance + ROOM
  const fits = (at: Point) =>
    at.x - SIDE / 2 - margin > Math.min(...xs) && at.x + SIDE / 2 + margin < Math.max(...xs) && at.y - SIDE / 2 - margin > Math.min(...ys) && at.y + SIDE / 2 + margin < Math.max(...ys) &&
    pads.every((pad) => shapeDistance(square(at), pad) > margin)
  const found = segments.map(([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).find(fits)
  if (found === undefined) throw new Error("no routed segment of can-node leaves room for the square")
  return found
}

const at = channel(routedBefore)
const withSquare = (net: string | undefined) => {
  const tag = `<boardgraphic file="graphics/block.svg" layer="top"${net ? ` net="${net}"` : ""} x={${at.x}} y={${at.y}} width={${SIDE}} />`
  const { [LAYOUT]: _routed, ...rest } = original
  return { ...rest, [MAIN]: (original[MAIN] as string).replace("</board>", `${tag}\n  </board>`), "graphics/block.svg": SQUARE }
}

/** Routes the unrouted board with the square and checks what the router laid against it. */
function routeRound(net: string | undefined) {
  const files = withSquare(net)
  const design = buildDesign(files, MAIN)
  expect(design.diagnostics.filter((d) => d.message.includes("boardgraphic"))).toEqual([])
  const lines = design.pcb.ratsnest.length
  const report = routeDesign(design)
  const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
  return { design, lines, report, after: checked.after }
}

/** Copper of a net other than `net` nearer the square than the clearance its class needs: tracks and vias. */
function tooNear(after: Design, net: string | undefined): string[] {
  const classOf = classLookup(after.rules, after.circuit.nets)
  const block = square(at)
  const gap = (other: string | undefined) => requiredClearance(after.rules, net === undefined ? "default" : classOf(net), classOf(other))
  const tracks = after.pcb.tracks.filter((t) => t.layer === "top" && (net === undefined || t.net !== net))
  const vias = after.pcb.vias.filter((v) => net === undefined || v.net !== net)
  return [
    ...tracks.filter((t) => t.points.slice(1).some((p, i) => breaksMinimum(shapeDistance(block, { core: [t.points[i] as Point, p], radius: t.width / 2 }), gap(t.net)))).map((t) => t.id),
    ...vias.filter((v) => breaksMinimum(shapeDistance(block, { core: [v.at], radius: v.diameter / 2 }), gap(v.net))).map((v) => v.id),
  ]
}

describe("the router round a copper drawing on can-node", () => {
  test("the square is put where routed tracks ran", () => {
    const through = routedBefore.pcb.tracks.filter((t) => t.points.slice(1).some((p, i) => shapeDistance(square(at), { core: [t.points[i] as Point, p], radius: t.width / 2 }) <= 0))
    expect(through.length).toBeGreaterThan(0)
  })

  test("of no net: every connection routed or reported, nothing nearer than the clearance, nothing names it", { timeout: 120_000 }, () => {
    const { lines, report, after } = routeRound(undefined)
    expect(report.routed.length + report.unrouted.length).toBe(lines)
    expect(tooNear(after, undefined)).toEqual([])
    const named = checkDesign(after).violations.filter((v) => v.items.includes("boardgraphic:1"))
    expect(named).toEqual([])
  })

  test("on GND: GND copper may touch it, every other net keeps clear, nothing but an island warning names it", { timeout: 120_000 }, () => {
    const { lines, report, after } = routeRound("GND")
    expect(report.routed.length + report.unrouted.length).toBeLessThanOrEqual(lines)
    const gnd = after.pcb.graphics?.[0]?.net
    expect(gnd).toBeDefined()
    expect(tooNear(after, gnd)).toEqual([])
    const named = checkDesign(after).violations.filter((v) => v.items.includes("boardgraphic:1") && v.code !== "drawing-floating")
    expect(named).toEqual([])
  })
})
