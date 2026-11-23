// Reference images in the Studio: drawn under the board (straightened when the fit has perspective), aligned by
// clicks that snap to holes and pads, their shown values held until a build has them, and the server's route.
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas"
import type { ReferenceRecord } from "../src/core/layout-references.js"
import { mapPoint, type Matrix3 } from "../src/engine/reference-fit.js"
import { referenceRoute } from "../src/studio/reference-route.js"
import { blocksRequest } from "../studio/src/ai-lock.js"
import { aligningMatrix, alignHint, alignMarks, drawAlignMarks, imagePixelAt, snapToBoard } from "../studio/src/pcb/reference-align.js"
import { boardFrameOf, drawReferenceLayers, imageTransform, referenceLayer, type ImageCtx, type MakeCanvas } from "../studio/src/pcb/reference-draw.js"
import * as store from "../studio/src/pcb/reference-store.js"
import { recorder } from "./helpers/fake-ctx.js"

const record = (fields: Partial<ReferenceRecord> = {}): ReferenceRecord => ({ t: "reference", id: "r1", file: "references/a.png", width: 200, height: 100, mirror: false, points: [], opacity: 0.5, shown: true, ...fields })
const make: MakeCanvas = (width, height) => {
  const canvas = createCanvas(width, height)
  return { canvas, ctx: canvas.getContext("2d") as unknown as ImageCtx }
}

/** A 200 x 100 picture: green on its left half, magenta on its right. */
async function halves(): Promise<Image> {
  const canvas = createCanvas(200, 100)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#00ff00"
  ctx.fillRect(0, 0, 100, 100)
  ctx.fillStyle = "#ff00ff"
  ctx.fillRect(100, 0, 100, 100)
  return loadImage(await canvas.encode("png"))
}

/** Board mm to pixels of a 400 x 200 picture of the board x -20..20, y -10..10. */
const WORLD: [number, number, number, number, number, number] = [10, 0, 0, -10, 200, 100]

async function drawn(layer: ReturnType<typeof referenceLayer>, x: number, y: number): Promise<number[]> {
  const canvas = createCanvas(400, 200)
  const ctx = canvas.getContext("2d")
  drawReferenceLayers(ctx as unknown as ImageCtx, [layer], WORLD)
  return [...ctx.getImageData(x, y, 1, 1).data]
}

describe("drawing reference images", () => {
  test("a scaled and turned image is drawn with one transform, at its opacity", async () => {
    const image = await halves()
    const points = [
      { image: { x: 0, y: 50 }, board: { x: -20, y: 0 } },
      { image: { x: 200, y: 50 }, board: { x: 20, y: 0 } },
    ]
    const layer = referenceLayer(record({ points, opacity: 1 }), image, undefined, make)
    expect(layer.image).toBe(image)
    expect((await drawn(layer, 100, 100)).slice(0, 3)).toEqual([0, 255, 0])
    expect((await drawn(layer, 300, 100)).slice(0, 3)).toEqual([255, 0, 255])
    const faded = await drawn({ ...layer, opacity: 0.5 }, 300, 100)
    expect(faded[3]).toBeGreaterThan(100)
    expect(faded[3]).toBeLessThan(150)
    expect((await drawn({ ...layer, opacity: 0 }, 300, 100))[3]).toBe(0)
  })

  test("a perspective fit is straightened into a board-space image first", async () => {
    const image = await halves()
    // The picture's corners land on a trapezoid: wide at the bottom, narrow at the top.
    const points = [
      { image: { x: 0, y: 0 }, board: { x: -15, y: 10 } },
      { image: { x: 200, y: 0 }, board: { x: 15, y: 10 } },
      { image: { x: 200, y: 100 }, board: { x: 20, y: -10 } },
      { image: { x: 0, y: 100 }, board: { x: -20, y: -10 } },
    ]
    const layer = referenceLayer(record({ points, opacity: 1 }), image, undefined, make)
    expect(layer.image).not.toBe(image)
    expect(layer.matrix[6]).toBe(0)
    // Left of centre near the top is green, right magenta; outside the trapezoid near the top corner nothing.
    expect((await drawn(layer, 150, 20)).slice(0, 3)).toEqual([0, 255, 0])
    expect((await drawn(layer, 250, 20)).slice(0, 3)).toEqual([255, 0, 255])
    expect((await drawn(layer, 20, 15))[3]).toBe(0)
  })

  test("the board frame and the transform", () => {
    expect(boardFrameOf({ board: undefined })).toBeUndefined()
    const outline = [
      { x: -10, y: -5 },
      { x: 30, y: -5 },
      { x: 30, y: 5 },
    ]
    expect(boardFrameOf({ board: { outline } as never })).toEqual({ centre: { x: 10, y: 0 }, width: 40 })
    expect(imageTransform(WORLD, [0.1, 0, -10, 0, -0.1, 5, 0, 0, 1])).toEqual([1, 0, 0, 1, 100, 50])
  })
})

describe("aligning on the canvas", () => {
  const board = { centre: { x: 0, y: 0 }, width: 40 }
  const pcb = { holes: [{ id: "h1", x: 5, y: 5, diameter: 3 }], parts: [{ pads: [{ x: -5, y: 2 }] }] } as never

  test("the image lies as written, moves onto one new pair, and fits two or more", () => {
    const r = record({ points: [] })
    const before = aligningMatrix(r, null, board)
    expect(mapPoint(before, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
    const one = aligningMatrix(r, { id: "r1", points: [{ image: { x: 100, y: 50 }, board: { x: 3, y: 4 } }] }, board)
    expect(mapPoint(one, { x: 100, y: 50 })).toEqual({ x: 3, y: 4 })
    expect(mapPoint(one, { x: 200, y: 50 }).x).toBeCloseTo(23)
    const two = aligningMatrix(r, { id: "r1", points: [{ image: { x: 0, y: 0 }, board: { x: 0, y: 0 } }, { image: { x: 100, y: 0 }, board: { x: 0, y: 10 } }] }, board)
    expect(mapPoint(two, { x: 100, y: 0 }).y).toBeCloseTo(10)
    expect(aligningMatrix(r, { id: "r2", points: [] }, board)).toEqual(before)
  })

  test("a click snaps to a hole or pad centre near it, and maps back to a pixel", () => {
    expect(snapToBoard({ x: 5.4, y: 4.8 }, pcb, 20)).toEqual({ x: 5, y: 5 })
    expect(snapToBoard({ x: -5.2, y: 2.1 }, pcb, 20)).toEqual({ x: -5, y: 2 })
    expect(snapToBoard({ x: 0, y: 0 }, pcb, 20)).toEqual({ x: 0, y: 0 })
    const m: Matrix3 = [0.2, 0, -20, 0, -0.2, 10, 0, 0, 1]
    const pixel = imagePixelAt(m, { x: 0, y: 0 })
    expect(pixel?.x).toBeCloseTo(100)
    expect(pixel?.y).toBeCloseTo(50)
    expect(imagePixelAt([0, 0, 0, 0, 0, 0, 0, 0, 1], { x: 0, y: 0 })).toBeUndefined()
  })

  test("the hint and the marks follow the run", () => {
    expect(alignHint({ id: "r1", points: [] })).toMatch(/point 1\. Click a point on the picture/)
    expect(alignHint({ id: "r1", points: [], picked: { x: 1, y: 1 } })).toMatch(/now click where it belongs on the board/)
    const pair = { image: { x: 0, y: 0 }, board: { x: 1, y: 1 } }
    expect(alignHint({ id: "r1", points: [pair, pair] })).toMatch(/four take out a photo's slant/)
    expect(alignHint({ id: "r1", points: [pair, pair, pair, pair] })).toMatch(/Add more/)
    const m: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    expect(alignMarks(m, null)).toEqual({ placed: [] })
    expect(alignMarks(m, { id: "r1", points: [pair], picked: { x: 3, y: 4 } })).toEqual({ placed: [{ x: 1, y: 1 }], picked: { x: 3, y: 4 } })
    const { ctx, records } = recorder()
    drawAlignMarks(ctx, { placed: [{ x: 1, y: 1 }], picked: { x: 3, y: 4 } }, (p) => p)
    expect(records.filter((r) => r.name === "stroke")).toHaveLength(2)
  })
})

describe("the reference store", () => {
  afterEach(() => {
    store.stopAligning()
    store.clearOverrides()
  })

  test("a run collects pairs, and shown values sit over the records until cleared", () => {
    store.startAligning("r1")
    expect(store.pickBoardPoint({ x: 1, y: 1 })).toEqual([])
    store.pickImagePoint({ x: 10, y: 20 })
    expect(store.pickBoardPoint({ x: 1, y: 2 })).toEqual([{ image: { x: 10, y: 20 }, board: { x: 1, y: 2 } }])
    expect(store.referenceState().aligning).toEqual({ id: "r1", points: [{ image: { x: 10, y: 20 }, board: { x: 1, y: 2 } }] })
    store.overrideReference("r1", { opacity: 0.9 })
    store.overrideReference("r1", { mirror: true })
    expect(store.shownReferences([record()], store.referenceState().overrides)[0]).toMatchObject({ opacity: 0.9, mirror: true })
    store.clearOverrides()
    expect(store.shownReferences(undefined, store.referenceState().overrides)).toEqual([])
    store.stopAligning()
    store.pickImagePoint({ x: 1, y: 1 })
    expect(store.pickBoardPoint({ x: 1, y: 1 })).toEqual([])
  })
})

describe("the server's reference route", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-reference-route-"))
    await writeFile(join(root, "main.circuit.tsx"), "export default () => <board width={40} height={20} />\n")
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  test("adds a picked image, changes it and removes it, each one history entry", async () => {
    const canvas = createCanvas(20, 10)
    const data = (await canvas.encode("png")).toString("base64")
    const added = await referenceRoute(root, { action: "add", file: "main.circuit.tsx", name: "bottom.png", data, mirror: true })
    expect(added).toMatchObject({ id: "r1", summary: expect.stringMatching(/added reference image r1 .*mirrored/) })
    const points = [
      { image: { x: 0, y: 0 }, board: { x: 0, y: 0 } },
      { image: { x: 10, y: 0 }, board: { x: 10, y: 0 } },
    ]
    expect((await referenceRoute(root, { action: "set", file: "main.circuit.tsx", id: "r1", points })).summary).toMatch(/^Each point lands/)
    expect((await referenceRoute(root, { action: "set", file: "main.circuit.tsx", id: "r1", opacity: 0.2 })).summary).toMatch(/20% opaque/)
    expect((await referenceRoute(root, { action: "remove", file: "main.circuit.tsx", id: "r1" })).summary).toMatch(/removed reference image r1/)
    expect(await readFile(join(root, "references", "bottom.png"))).toBeTruthy()
    await expect(referenceRoute(root, { action: "add", file: "main.circuit.tsx", name: "empty.png", data: "" })).rejects.toThrow(/empty/)
  })

  test("is a write the AI lock holds back", () => {
    expect(blocksRequest("/api/reference", { action: "remove" })).toBe(true)
  })
})
