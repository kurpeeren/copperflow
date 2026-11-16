import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkCircuit, formatBoardImport, importBoard, listEntries, undoChange } from "../src/core/index.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "index.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures/dxf", import.meta.url))
const meta = { author: "ai" as const, engine: inProcessEngine }
let root: string

const source = () => readFile(join(root, FILE), "utf8")
const entries = async () => (await listEntries(root, 100)).length

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-board-import-"))
  await cp(EXAMPLE, root, { recursive: true })
  await cp(FIXTURES, join(root, "drawings"), { recursive: true })
})

describe("importBoard", () => {
  test("writes the outline and the holes as one history entry and answers in a few lines", async () => {
    const before = await entries()
    const result = await importBoard(root, FILE, { dxf: "drawings/rectangle-holes.dxf" }, meta)
    expect(await entries()).toBe(before + 1)
    const text = await source()
    expect(text).toContain("<board outline={[{ x: -41, y: -27 }, { x: 41, y: -27 }, { x: 41, y: 27 }, { x: -41, y: 27 }]} schMaxTraceDistance={0.5}>")
    expect(text).not.toContain('width="30mm"')
    expect(text).toContain("<hole x={-37} y={-23} diameter={3.2} />")
    expect(formatBoardImport(result)).toEqual([
      `Change ${result.entry.id}: board outline from rectangle-holes.dxf: 4 corners, 82 x 54 mm (drawing in mm, moved by -41, -27)`,
      "4 holes: 3.2 mm at (-37, -23), (37, -23), (37, 23), (-37, 23)",
    ])
  })

  test("undo brings the old board back", async () => {
    const old = await source()
    await importBoard(root, FILE, { dxf: "drawings/rectangle-holes.dxf" }, meta)
    await undoChange(root, { author: "ai" })
    expect(await source()).toBe(old)
  })

  test("an inner shape becomes a keepout; what is not used is listed; a board with holes is refused unless replace", async () => {
    await importBoard(root, FILE, { dxf: "drawings/rectangle-holes.dxf" }, meta)
    const refused = importBoard(root, FILE, { dxf: "drawings/inner-shape.dxf" }, meta)
    await expect(refused).rejects.toThrow("The board already has 4 holes; pass replace: true to replace them")
    const result = await importBoard(root, FILE, { dxf: "drawings/inner-shape.dxf", replace: true }, meta)
    const text = await source()
    expect(text).not.toContain("<hole")
    expect(text).toContain('<keepout outline={[{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 0 }]} layers="all" />')
    expect(formatBoardImport(result)).toEqual([
      `Change ${result.entry.id}: board outline from inner-shape.dxf: 4 corners, 100 x 60 mm (drawing in mm, assumed as the file names no units, moved by -50, -30)`,
      "1 inner shape kept clear as keepout:1 (not cut out of the board)",
      "Replaced the board's 4 holes.",
      "Not used: 1 circle outside the outline",
    ])
    const again = await importBoard(root, FILE, { dxf: "drawings/spline-open.dxf", replace: true, origin: "keep" }, meta)
    expect(formatBoardImport(again)).toEqual([
      `Change ${again.entry.id}: board outline from spline-open.dxf: 4 corners, 50 x 30 mm (drawing in mm, not moved)`,
      "Replaced the board's 1 keepout.",
      "Not used: 2 SPLINE, 1 open chain of 3 lines",
      // Kept where drawn, the board lies at 0..50 mm, so the parts left of it are off the board now.
      "6 placed parts are now outside the outline: J1, R1, R2, C1, U1, J2; move them inside",
    ])
  })

  test("parts left outside the new outline are counted, and the board-edge rule reports them", async () => {
    const result = await importBoard(root, FILE, { dxf: "drawings/inner-shape.dxf", layer: "Cutout" }, meta)
    expect(result.outside).toContain("J1")
    expect(formatBoardImport(result).at(-1)).toMatch(/^\d+ placed parts are now outside the outline: .*J1.*; move them inside$/)
    const check = await checkCircuit(root, FILE, { engine: inProcessEngine })
    expect(check.ok).toBe(false)
    expect(JSON.stringify(check)).toContain("J1")
    expect(JSON.stringify(check)).toMatch(/is outside the board/)
  })

  test("refuses a drawing outside the project, a missing one and an unclear one, writing nothing", async () => {
    const before = await source()
    await expect(importBoard(root, FILE, { dxf: "../outside.dxf" }, meta)).rejects.toThrow(/outside the project root/)
    await expect(importBoard(root, FILE, { dxf: "drawings/missing.dxf" }, meta)).rejects.toThrow("There is no file drawings/missing.dxf in the project folder")
    await writeFile(join(root, "open.dxf"), "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n5\n21\n0\n0\nENDSEC\n0\nEOF\n")
    await expect(importBoard(root, FILE, { dxf: "open.dxf" }, meta)).rejects.toThrow("open.dxf: No closed shape was found: 1 open chain of 1 line")
    expect(await source()).toBe(before)
  })

  test("takes a drawing's text, as the Studio sends it", async () => {
    const text = await readFile(join(FIXTURES, "bulges.dxf"), "utf8")
    const result = await importBoard(root, FILE, { dxf: { name: "case.dxf", text } }, meta)
    expect(formatBoardImport(result)[0]).toMatch(/board outline from case\.dxf: \d+ corners, 59\.9\d* x 20 mm/)
  })
})
