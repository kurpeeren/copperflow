// Reference images kept in the project and listed in the layout file: add (photo, scan or Gerber layer), change
// (points, mirror, opacity, shown), remove, each one history entry; the build carries them, no export reads them.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { imageSize } from "../src/core/image-size.js"
import { addReference, formatReference, removeReference, setReference } from "../src/core/references.js"
import { undoChange } from "../src/core/workspace.js"
import { writeGerber } from "../src/engine/fab/gerber.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={40} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
  </board>
)
`

/** The start of a PNG: the signature and the IHDR chunk, enough to read its size. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** A JPEG's start: SOI, an APP0 segment, then the SOF0 frame with its size. */
function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0])
}

let root: string
const meta = { author: "ai" as const }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-references-"))
  await writeFile(join(root, FILE), CIRCUIT)
})

const layout = () => readFile(join(root, "main.circuit.layout.json"), "utf8")

describe("imageSize", () => {
  test("reads PNG, JPEG and SVG sizes, and nothing from other bytes", () => {
    expect(imageSize(pngHeader(640, 480))).toEqual({ kind: "png", width: 640, height: 480 })
    expect(imageSize(jpegHeader(1600, 1200))).toEqual({ kind: "jpeg", width: 1600, height: 1200 })
    const svg = (attrs: string) => imageSize(new TextEncoder().encode(`<?xml version="1.0"?><svg ${attrs}></svg>`))
    expect(svg('width="300" height="200px"')).toEqual({ kind: "svg", width: 300, height: 200 })
    expect(svg('width="3cm" height="2cm" viewBox="0 0 30 20"')).toEqual({ kind: "svg", width: 30, height: 20 })
    expect(svg('viewBox="0 0 0 20"')).toBeUndefined()
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined()
    // An EXIF orientation that turns the photo a quarter swaps its size, as it is shown; others leave it.
    const exif = (orientation: number, little: boolean) => {
      const short = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
      const long = (n: number) => (little ? [n & 255, 0, 0, 0] : [0, 0, 0, n & 255])
      const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...short(42), ...long(8), ...short(2), ...short(0x0100), ...short(3), ...long(1), ...short(5), 0, 0, ...short(0x0112), ...short(3), ...long(1), ...short(orientation), 0, 0, 0, 0, 0, 0]
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
      const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
      const plain = jpegHeader(1600, 1200)
      return new Uint8Array([...plain.slice(0, 2), ...app1, ...plain.slice(2)])
    }
    expect(imageSize(exif(6, false))).toEqual({ kind: "jpeg", width: 1200, height: 1600 })
    expect(imageSize(exif(8, true))).toEqual({ kind: "jpeg", width: 1200, height: 1600 })
    expect(imageSize(exif(3, true))).toEqual({ kind: "jpeg", width: 1600, height: 1200 })
    expect(imageSize(new TextEncoder().encode("hello"))).toBeUndefined()
  })
})

describe("addReference", () => {
  test("a photo in the project is kept under references/ and listed in the layout file", async () => {
    await mkdir(join(root, "photos"))
    await writeFile(join(root, "photos", "bottom side.jpg"), jpegHeader(1200, 1600))
    const result = await addReference(root, FILE, { source: "photos/bottom side.jpg", mirror: true, opacity: 0.4 }, meta)
    expect(result.record).toMatchObject({ id: "r1", file: "references/bottom side.jpg", width: 1200, height: 1600, mirror: true, opacity: 0.4, shown: true })
    expect(await readFile(join(root, "references", "bottom side.jpg"))).toHaveLength(22)
    expect(await layout()).toContain('"t":"reference","id":"r1"')
    // Without points it is centred on the board, across its width.
    expect(result.fit.kind).toBe("placed")
    const lines = formatReference(result)
    expect(lines[0]).toMatch(/^Change \S+: added reference image r1 \(references\/bottom side.jpg, 1200 x 1600 px\), mirrored, 40% opaque\.$/)
    expect(lines[1]).toMatch(/^No points: placed at a set scale/)
    expect(lines.at(-1)).toMatch(/never in Gerbers.*render \{ reference: true \}/)
  })

  test("the same image twice keeps one file; a different one with that name is numbered", async () => {
    const picked = { name: "top.png", bytes: pngHeader(10, 10) }
    await addReference(root, FILE, { source: picked }, meta)
    const again = await addReference(root, FILE, { source: picked }, meta)
    const other = await addReference(root, FILE, { source: { name: "top.png", bytes: pngHeader(20, 10) } }, meta)
    expect([again.record.id, again.record.file]).toEqual(["r2", "references/top.png"])
    expect(other.record.file).toBe("references/top-2.png")
  })

  test("a Gerber layer is drawn as an SVG at its own scale", async () => {
    const gerber = writeGerber({ fileFunction: "Copper,L1,Top", polarity: "Positive", objects: [{ kind: "draw", points: [{ x: 0, y: 0 }, { x: 30, y: 10 }], width: 0.5 }] }, new Date("2026-11-23T00:00:00Z"))
    const result = await addReference(root, FILE, { source: { name: "board.GTL", bytes: new TextEncoder().encode(gerber) } }, meta)
    expect(result.record).toMatchObject({ file: "references/board.svg", source: "board.GTL", pixel: 0.05 })
    expect(await readFile(join(root, "references", "board.svg"), "utf8")).toMatch(/^<svg /)
    // At the layer's own scale: 32.5 mm across is 650 pixels.
    expect(result.record.width).toBe(650)
    expect(formatReference(result)[0]).toContain("drawn from board.GTL")
  })

  test("what is not an image, too many points, a bad opacity or a missing file is refused", async () => {
    await expect(addReference(root, FILE, { source: { name: "notes.txt", bytes: new TextEncoder().encode("hi") } }, meta)).rejects.toThrow(/not a reference image/)
    await expect(addReference(root, FILE, { source: { name: "x.gbr", bytes: new TextEncoder().encode("%FSLAX36Y36*%\nM02*") } }, meta)).rejects.toThrow(/x.gbr: the layer draws nothing/)
    await expect(addReference(root, FILE, { source: "nowhere.png" }, meta)).rejects.toThrow(/There is no file nowhere.png/)
    await expect(addReference(root, FILE, { source: ".." }, meta)).rejects.toThrow(/outside the project/)
    await mkdir(join(root, "folder"))
    await expect(addReference(root, FILE, { source: "folder" }, meta)).rejects.toThrow(/not a file/)
    const picked = { name: "a.png", bytes: pngHeader(10, 10) }
    await expect(addReference(root, FILE, { source: picked, opacity: 2 }, meta)).rejects.toThrow(/opacity is from 0/)
    const point = { image: { x: 1, y: 1 }, board: { x: 1, y: 1 } }
    await expect(addReference(root, FILE, { source: picked, points: Array.from({ length: 21 }, () => point) }, meta)).rejects.toThrow(/at most 20 points/)
    await expect(addReference(root, FILE, { source: picked, points: [{ image: { x: Number.NaN, y: 1 }, board: { x: 1, y: 1 } }] }, meta)).rejects.toThrow(/points\[0\] needs finite numbers/)
  })
})

describe("setReference and removeReference", () => {
  test("points align it, and each point's miss is said", async () => {
    await addReference(root, FILE, { source: { name: "top.png", bytes: pngHeader(1000, 500) } }, meta)
    const points = [
      { image: { x: 100, y: 100 }, board: { x: -15, y: 5 } },
      { image: { x: 900, y: 100 }, board: { x: 15, y: 5 } },
      { image: { x: 900, y: 400 }, board: { x: 15, y: -6.5 } },
    ]
    const result = await setReference(root, FILE, "r1", { points, shown: false }, meta)
    expect(result.fit.kind).toBe("similar")
    const lines = formatReference(result)
    expect(lines[0]).toMatch(/changed reference image r1 .*, hidden\.$/)
    expect(lines[1]).toBe("3 points: scaled, turned and moved onto the points.")
    expect(lines[2]).toMatch(/^Each point lands this far from its board point: #1 [\d.]+ mm, #2 [\d.]+ mm, #3 [\d.]+ mm\.$/)
  })

  test("removing keeps the image, and undo brings the line back", async () => {
    await addReference(root, FILE, { source: { name: "top.png", bytes: pngHeader(10, 10) } }, meta)
    const result = await removeReference(root, FILE, "r1", meta)
    expect(formatReference(result)[0]).toMatch(/removed reference image r1 .* The image stays in references\/; undo brings the reference back\./)
    expect(await layout()).not.toContain("reference")
    await undoChange(root, { author: "human" })
    expect(await layout()).toContain('"id":"r1"')
  })

  test("an unknown id, or a change that changes nothing, is refused", async () => {
    await expect(setReference(root, FILE, "r1", { opacity: 0.2 }, meta)).rejects.toThrow(/There is no reference image r1$/)
    await addReference(root, FILE, { source: { name: "top.png", bytes: pngHeader(10, 10) } }, meta)
    await expect(removeReference(root, FILE, "r9", meta)).rejects.toThrow(/There is no reference image r9; there are r1/)
    await expect(setReference(root, FILE, "r1", { opacity: 0.5 }, meta)).rejects.toThrow(/made no change/)
  })

  test("the build carries the references and leaves the board as it was", async () => {
    await addReference(root, FILE, { source: { name: "top.png", bytes: pngHeader(10, 10) } }, meta)
    const design = await inProcessEngine.build(root, FILE)
    expect(design.references?.map((r) => r.id)).toEqual(["r1"])
    expect(design.pcb.graphics ?? []).toEqual([])
  })
})
