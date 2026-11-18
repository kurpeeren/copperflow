import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile, cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { boardFromSvg } from "../src/core/board-import-svg.js"
import { formatBoardImport, importBoard } from "../src/core/index.js"
import { boardFromDxf, type BoardFromDrawing } from "../src/engine/dxf/index.js"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import type { Point } from "../src/engine/model.js"

/** A 60 x 40 mm board with 3 mm corners, two 3.2 mm holes and a 10 mm square window, drawn as lines. */
const BOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40" fill="none" stroke="black" stroke-width="0.1">
  <rect x="0" y="0" width="60" height="40" rx="3"/>
  <circle cx="5" cy="5" r="1.6"/>
  <circle cx="55" cy="35" r="1.6"/>
  <rect x="25" y="15" width="10" height="10"/>
</svg>`

const BULGE = Math.tan(Math.PI / 8)
const BOARD_DXF = [
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LWPOLYLINE", "8", "0", "90", "8", "70", "1",
  ...[[3, 0, 0], [57, 0, BULGE], [60, 3, 0], [60, 37, BULGE], [57, 40, 0], [3, 40, BULGE], [0, 37, 0], [0, 3, BULGE]].flatMap(([x, y, b]) => ["10", String(x), "20", String(y), "42", String(b)]),
  "0", "CIRCLE", "8", "0", "10", "5", "20", "35", "40", "1.6",
  "0", "CIRCLE", "8", "0", "10", "55", "20", "5", "40", "1.6",
  "0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1", "10", "25", "20", "15", "10", "35", "20", "15", "10", "35", "20", "25", "10", "25", "20", "25",
  "0", "ENDSEC", "0", "EOF",
].join("\n")

const area = (ring: readonly Point[]) => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length] as Point
  return sum + a.x * b.y - b.x * a.y
}, 0) / 2

const box = (ring: readonly Point[]) => {
  const xs = ring.map((p) => p.x)
  const ys = ring.map((p) => p.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

const sortedHoles = (board: BoardFromDrawing) => [...board.holes].sort((a, b) => a.x - b.x)

describe("the board from an SVG", () => {
  test("a rounded rectangle with two round holes and a square window: the outline, two holes and one inner shape", () => {
    const board = boardFromSvg(BOARD_SVG)
    expect(board.width).toBeCloseTo(60, 3)
    expect(board.height).toBeCloseTo(40, 3)
    expect(area(board.outline)).toBeGreaterThan(0)
    expect(box(board.outline).map((v) => Math.round(v * 1000) / 1000)).toEqual([-30, -20, 30, 20])
    const holes = sortedHoles(board)
    expect(holes).toHaveLength(2)
    expect(holes[0]).toEqual({ x: -25, y: 15, diameter: 3.2 })
    expect(holes[1]).toEqual({ x: 25, y: -15, diameter: 3.2 })
    expect(board.keepouts).toHaveLength(1)
    expect(box(board.keepouts[0] ?? []).map((v) => Math.round(v * 1000) / 1000)).toEqual([-5, -5, 5, 5])
    expect(board.units).toEqual({ name: "mm", from: "file" })
  })

  test("gives the same board as the same drawing in DXF, within 0.01 mm", () => {
    const svg = boardFromSvg(BOARD_SVG)
    const dxf = boardFromDxf(BOARD_DXF)
    expect(svg.width).toBeCloseTo(dxf.width, 2)
    expect(svg.height).toBeCloseTo(dxf.height, 2)
    expect(svg.offset.x).toBeCloseTo(dxf.offset.x, 2)
    expect(Math.abs(area(svg.outline) - area(dxf.outline))).toBeLessThan(0.05)
    const [a, b] = [sortedHoles(svg), sortedHoles(dxf)]
    expect(a).toHaveLength(b.length)
    a.forEach((hole, i) => {
      expect(Math.abs(hole.x - (b[i]?.x ?? NaN))).toBeLessThanOrEqual(0.01)
      expect(Math.abs(hole.y - (b[i]?.y ?? NaN))).toBeLessThanOrEqual(0.01)
      expect(Math.abs(hole.diameter - (b[i]?.diameter ?? NaN))).toBeLessThanOrEqual(0.01)
    })
    expect(svg.keepouts.map(box)).toEqual(dxf.keepouts.map(box))
  })

  test("takes the outline from a filled area too, its holes from the area's openings", () => {
    const filled = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
      <path fill-rule="evenodd" d="M0 0 H60 V40 H0 Z M3.4 5 A1.6 1.6 0 1 0 6.6 5 A1.6 1.6 0 1 0 3.4 5 Z M25 15 H35 V25 H25 Z"/></svg>`
    const board = boardFromSvg(filled)
    expect(board.outline).toHaveLength(4)
    expect(board.holes).toEqual([{ x: -25, y: 15, diameter: 3.2 }])
    expect(board.keepouts).toHaveLength(1)
  })

  test("refuses an SVG with no physical size: a board must have real dimensions", () => {
    expect(() => boardFromSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><rect width="60" height="40"/></svg>')).toThrow(
      "The SVG gives no physical size (width and height in mm, cm, in, pt or pc); a board must have real dimensions",
    )
    expect(() => boardFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="600px" height="400px"><rect width="60" height="40"/></svg>')).toThrow(/no physical size/)
  })

  test("refuses an open path, as an open outline in a DXF is refused", () => {
    expect(() => boardFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><path d="M0 0 H60 V40 H0" fill="none" stroke="black"/></svg>')).toThrow(
      /^No closed shape was found: 1 open line$/,
    )
  })

  test("colour does not change a board: a stroke is its centre line, a white circle a hole", () => {
    const white = `<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20"><rect x="0.5" y="0.5" width="29" height="19" fill="none" stroke="black" stroke-width="1"/><circle cx="26" cy="4" r="1.6" fill="white"/></svg>`
    const board = boardFromSvg(white)
    expect(board.width).toBeCloseTo(29, 3)
    expect(board.height).toBeCloseTo(19, 3)
    expect(board.holes).toEqual([{ x: 11, y: 6, diameter: 3.2 }])
    expect(board.keepouts).toEqual([])
    expect(boardFromSvg(white.replace('fill="white"', 'fill="black"'))).toEqual(board)
  })

  test("reads the size from the parsed root, not from a comment", () => {
    const text = '<!-- <svg width="10mm" height="10mm"> --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><rect width="60" height="40"/></svg>'
    expect(() => boardFromSvg(text)).toThrow(/no physical size/)
  })

  test("takes an outline of more than 120,000 points", () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="140mm" height="10mm" viewBox="0 0 140 10"><path d="M0 0 ${"h.001".repeat(130000)} v10 H0 Z"/></svg>`
    expect(boardFromSvg(text).width).toBeCloseTo(130, 3)
  })

  test("refuses more closed shapes than it compares, in plain words", () => {
    const circles = Array.from({ length: 5001 }, (_, i) => `<rect x="${(i % 100) * 0.5 + 1}" y="${Math.floor(i / 100) * 0.5 + 1}" width="0.2" height="0.2"/>`).join("")
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40" fill="none" stroke="black"><rect width="60" height="40"/>${circles}</svg>`
    expect(() => boardFromSvg(text)).toThrow("The drawing has more than 5000 closed shapes; simplify it first")
  })

  test("refuses layer and units: an SVG has neither", () => {
    expect(() => boardFromSvg(BOARD_SVG, { layer: "Outline" })).toThrow("An SVG has no layers; leave out layer")
    expect(() => boardFromSvg(BOARD_SVG, { units: "inch" })).toThrow("An SVG's units come from its width and height; leave out units")
  })
})

describe("import_board, the CLI and the Studio take an SVG", () => {
  const FILE = "index.circuit.tsx"
  const meta = { author: "ai" as const, engine: inProcessEngine }
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-board-svg-"))
    await cp(fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url)), root, { recursive: true })
    await writeFile(join(root, "board.svg"), BOARD_SVG)
  })

  test("importBoard writes the outline, holes and inner shape from an .svg in the project", async () => {
    const result = await importBoard(root, FILE, { dxf: "board.svg" }, meta)
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toContain("<hole x={-25} y={15} diameter={3.2} />")
    expect(text).toContain("<keepout")
    expect(formatBoardImport(result)[0]).toMatch(/board outline from board\.svg: \d+ corners, 60 x 40 mm \(drawing in mm, moved by -30, -20\)$/)
  })

  test("importBoard takes an .svg the Studio sends by name and text", async () => {
    const result = await importBoard(root, FILE, { dxf: { name: "picked.svg", text: BOARD_SVG } }, meta)
    expect(result.board.holes).toHaveLength(2)
  })

  test("copperflow board --svg", async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(["board", FILE, "--svg", "board.svg"], root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out.join("\n")).toMatch(/board outline from board\.svg/)
  })
})
