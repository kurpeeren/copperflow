// A drawing on copper (`<boardgraphic layer="top">`): copper of no net that every net keeps clear of. The checks
// measure it as triangles (its holes left open), the pours clear it, the router goes round it, and the Gerber copper
// file and the pictures carry it. The SVG reader is the real one.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { gerberFiles } from "../../src/engine/fab/layers.js"
import { boardPicture } from "../../src/engine/fab/picture/board-picture.js"
import { graphicBox } from "../../src/engine/graphic-place.js"
import { readGerber } from "../helpers/gerber-read.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"
/** A 6 × 6 mm square with a 3 × 3 mm hole in its middle. */
const FRAME = `<svg xmlns="http://www.w3.org/2000/svg" width="6mm" height="6mm" viewBox="0 0 6 6"><path d="M0 0 H6 V6 H0 Z M1.5 1.5 V4.5 H4.5 V1.5 Z" fill="black" fill-rule="evenodd"/></svg>`
/** A 2 × 8 mm bar. */
const BAR = `<svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="8mm" viewBox="0 0 2 8"><rect x="0" y="0" width="2" height="8" fill="black"/></svg>`
/** A 4 mm line 0.05 mm wide. */
const THIN = `<svg xmlns="http://www.w3.org/2000/svg" width="4mm" height="1mm" viewBox="0 0 4 1"><line x1="0" y1="0.5" x2="4" y2="0.5" stroke="black" stroke-width="0.05"/></svg>`
const FILES = { "graphics/frame.svg": FRAME, "graphics/bar.svg": BAR, "graphics/thin.svg": THIN }

const circuit = (items: string, extra = "") => `export default () => (<board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-7} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={7} pcbY={0} />
    <trace from="R1.pin1" to="net.GND" />
    <trace from="R2.pin1" to="net.GND" />
    <trace from="R1.pin2" to="net.SIG" />
    <trace from="R2.pin2" to="net.SIG" />
    <hole x={-8} y={4} diameter={1.5} />
    ${extra}
    ${items}
  </board>)`
const track = (points: { x: number; y: number }[], layer = "top") => `${JSON.stringify({ t: "track", id: "t0001", net: "SIG", layer, width: 0.25, points, locked: false, by: "human" })}\n`
const build = (items: string, layout?: string, extra = "") => buildDesign({ [MAIN]: circuit(items, extra), ...FILES, ...(layout === undefined ? {} : { [LAYOUT]: layout }) }, MAIN)
const FRAME_AT_ORIGIN = `<boardgraphic file="graphics/frame.svg" layer="top" x={0} y={0} width={6} />`
const about = (design: Design) => design.violations.filter((v) => v.items.includes("boardgraphic:1"))

describe("the element on copper", () => {
  test("is built with its triangles, not as a net", () => {
    const design = build(FRAME_AT_ORIGIN)
    expect(design.diagnostics.filter((d) => d.message.startsWith("boardgraphic"))).toEqual([])
    const graphic = design.pcb.graphics?.[0]
    expect(graphic?.layer).toBe("top")
    expect(graphic?.triangles?.length).toBeGreaterThanOrEqual(8)
    expect(design.circuit.nets.flatMap((net) => net.names).some((name) => name.includes("drawing"))).toBe(false)
    expect(design.pcb.ratsnest.some((line) => JSON.stringify(line).includes("boardgraphic"))).toBe(false)
    expect(about(design)).toEqual([])
  })

  test("a net, and an inner layer on a 2-layer board, are refused with the reason", () => {
    const withNet = build(`<boardgraphic file="graphics/frame.svg" layer="top" net="GND" x={0} y={0} width={6} />`)
    expect(withNet.pcb.graphics).toBeUndefined()
    expect(withNet.diagnostics.map((d) => d.message).join("\n")).toContain("a drawing on copper belongs to no net yet")
    const inner = build(`<boardgraphic file="graphics/frame.svg" layer="inner1" x={0} y={0} width={6} />`)
    expect(inner.pcb.graphics).toBeUndefined()
    expect(inner.diagnostics.map((d) => d.message).join("\n")).toContain("a 2-layer board has no inner1")
  })
})

describe("the checks", () => {
  test("a track through it touches it, worded for a person", () => {
    const found = about(build(FRAME_AT_ORIGIN, track([{ x: -4, y: 2.5 }, { x: 4, y: 2.5 }])))
    expect(found.map((v) => v.message)).toContain("boardgraphic:1 touches the track t0001 of SIG; a drawing on copper must stand clear of every net")
  })

  test("a track 0.05 mm away is a clearance violation", () => {
    const found = about(build(FRAME_AT_ORIGIN, track([{ x: 3.175, y: -2 }, { x: 3.175, y: 2 }])))
    expect(found.map((v) => v.code)).toEqual(["copper-clearance"])
    expect(found[0]?.message).toMatch(/^boardgraphic:1 is 0\.050 mm from the track t0001 of SIG; /)
  })

  test("copper inside its hole and clear of the rim is not reported", () => {
    expect(about(build(FRAME_AT_ORIGIN, track([{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }])))).toEqual([])
  })

  test("too near the board edge, over a hole, and lines thinner than the minimum track width", () => {
    expect(about(build(`<boardgraphic file="graphics/frame.svg" layer="top" x={8.5} y={-2} width={6} />`)).map((v) => v.code)).toContain("copper-edge")
    expect(about(build(`<boardgraphic file="graphics/frame.svg" layer="bottom" x={-6} y={3} width={4} />`)).map((v) => v.code)).toContain("copper-hole")
    const thin = about(build(`<boardgraphic file="graphics/thin.svg" layer="top" x={0} y={0} width={4} />`))
    expect(thin.map((v) => v.code)).toEqual(["drawing-width"])
    expect(thin[0]?.message).toContain("has lines 0.050 mm wide; the fabrication minimum track width is 0.100 mm")
  })

  test("silkscreen checks do not apply to it", () => {
    expect(about(build(`<boardgraphic file="graphics/frame.svg" layer="top" x={-7} y={0} width={4} />`)).some((v) => v.code.startsWith("silk"))).toBe(false)
  })
})

describe("a pour", () => {
  const POUR = `<copperpour net="GND" layer="top" />`
  test("of a net stands clear of it by the clearance, with no violation", () => {
    const plain = build("", undefined, POUR)
    const design = build(FRAME_AT_ORIGIN, undefined, POUR)
    expect(about(design)).toEqual([])
    const area = (d: Design) => d.pcb.pours.reduce((sum, fill) => sum + fill.area, 0)
    expect(area(design)).toBeLessThan(area(plain) - (36 - 9))
    // No fill reaches into the drawing's box grown by less than the clearance (its hole holds only an island, removed).
    const box = graphicBox(design.pcb.graphics![0]!)
    const near = (p: { x: number; y: number }) => p.x > box.minX - 0.1 && p.x < box.maxX + 0.1 && p.y > box.minY - 0.1 && p.y < box.maxY + 0.1
    expect(design.pcb.pours.some((fill) => fill.polygons.some((polygon) => polygon.outer.some(near)))).toBe(false)
  })
})

describe("the router", () => {
  test("goes round a bar on both layers, never through it, and leaves no violation", () => {
    const items = `<boardgraphic file="graphics/bar.svg" layer="top" x={0} y={0} width={2} /><boardgraphic file="graphics/bar.svg" layer="bottom" x={0} y={0} width={2} />`
    const files = { [MAIN]: circuit(items), ...FILES }
    const design = buildDesign(files, MAIN)
    const report = routeDesign(design)
    const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
    expect(checked.copper.filter((v) => v.items.some((item) => item.startsWith("boardgraphic")))).toEqual([])
    expect(report.unrouted.length + report.routed.length).toBe(2)
    for (const route of report.routed) {
      for (const one of route.copper.tracks) for (const p of one.points) expect(Math.abs(p.x) < 1 && Math.abs(p.y) < 4).toBe(false)
    }
  })
})

describe("the outputs", () => {
  const CREATED = new Date(0)
  const copperFile = (design: Design, side: "F" | "B") => readGerber(gerberFiles(design.pcb, design.rules.fabrication, "b", CREATED).find((f) => f.file.startsWith(`b-${side}_Cu.`))?.text ?? "")

  test("the top copper file gains one dark region per area inside its box and no clear region; the bottom gains nothing", () => {
    const design = build(FRAME_AT_ORIGIN)
    const plain = build("")
    const box = graphicBox(design.pcb.graphics![0]!)
    const top = copperFile(design, "F")
    const added = top.regions.length - copperFile(plain, "F").regions.length
    expect(added).toBe(design.pcb.graphics![0]!.areas.length)
    expect(top.regions.every((r) => r.polarity === "dark")).toBe(true)
    const inside = (p: { x: number; y: number }) => p.x >= box.minX - 1e-3 && p.x <= box.maxX + 1e-3 && p.y >= box.minY - 1e-3 && p.y <= box.maxY + 1e-3
    expect(top.regions.slice(-added).every((r) => r.points.every(inside))).toBe(true)
    expect(copperFile(design, "B").regions.length).toBe(copperFile(plain, "B").regions.length)
  })

  test("the picture shows it under the mask, and bare where a mask opening lies over it", () => {
    const pixelAt = (design: Design, x: number, y: number) => {
      const picture = boardPicture(design, { side: "top", pxPerMm: 8 })
      const col = Math.round(x / picture.mmPerPx + picture.origin.x)
      const row = Math.round(picture.origin.y - y / picture.mmPerPx)
      const i = (row * picture.width + col) * 4
      return [picture.rgba[i], picture.rgba[i + 1], picture.rgba[i + 2]].join(",")
    }
    const plain = pixelAt(build(""), 0, 2.2)
    const covered = pixelAt(build(FRAME_AT_ORIGIN), 0, 2.2)
    const bare = pixelAt(build(`${FRAME_AT_ORIGIN}<boardgraphic file="graphics/frame.svg" layer="top-mask" x={0} y={0} width={6} />`), 0, 2.2)
    expect(covered).not.toBe(plain)
    expect(bare).not.toBe(covered)
    expect(bare).not.toBe(plain)
  })
})
