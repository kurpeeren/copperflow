// The picture's one source: each layer's coverage image, drawn from the layer objects the Gerber files are written from,
// against the same layer drawn by an independent rasterizer (the canvas package) from that layer's own Gerber text as
// read back by an independent parser; the drill images against the drill files the same way.
import { fileURLToPath } from "node:url"
import { createCanvas } from "@napi-rs/canvas"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { drillFiles, drillHoles } from "../../src/engine/fab/excellon.js"
import { gerberLayers } from "../../src/engine/fab/layers.js"
import { writeGerber } from "../../src/engine/fab/gerber.js"
import { bodyImage, holesImage, layerImage } from "../../src/engine/fab/picture/layer-images.js"
import { gridFor, type Coverage, type Grid } from "../../src/engine/fab/picture/raster.js"
import { readDrill } from "../helpers/drill-read.js"
import { readGerber } from "../helpers/gerber-read.js"
import { filesIn } from "../helpers/place-fixtures.js"

const PX_PER_MM = 20
const CREATED = new Date(Date.UTC(2026, 10, 17))
type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>

/** The layer as the canvas draws it from the parsed file, as coverage 0 to 1 (its alpha). */
function drawn(grid: Grid, paint: (ctx: Ctx) => void): Coverage {
  const canvas = createCanvas(grid.width, grid.height)
  const ctx = canvas.getContext("2d")
  ctx.setTransform(grid.pxPerMm, 0, 0, -grid.pxPerMm, -grid.minX * grid.pxPerMm, grid.maxY * grid.pxPerMm)
  ctx.fillStyle = "#000"
  ctx.strokeStyle = "#000"
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  paint(ctx)
  const rgba = ctx.getImageData(0, 0, grid.width, grid.height).data
  const data = new Float32Array(grid.width * grid.height)
  for (let i = 0; i < data.length; i += 1) data[i] = (rgba[i * 4 + 3] as number) / 255
  return { width: grid.width, height: grid.height, data }
}

function flash(ctx: Ctx, at: { x: number; y: number }, shape: Record<string, unknown> & { type: string }): void {
  const num = (key: string) => shape[key] as number
  switch (shape.type) {
    case "circle":
      ctx.beginPath()
      ctx.arc(at.x, at.y, num("diameter") / 2, 0, 2 * Math.PI)
      ctx.fill()
      return
    case "rectangle":
      ctx.fillRect(at.x - num("xSize") / 2, at.y - num("ySize") / 2, num("xSize"), num("ySize"))
      return
    case "obround": {
      const [w, h] = [num("xSize"), num("ySize")]
      const half = Math.abs(w - h) / 2
      ctx.lineWidth = Math.min(w, h)
      ctx.beginPath()
      if (w >= h) {
        ctx.moveTo(at.x - half, at.y)
        ctx.lineTo(at.x + half, at.y)
      } else {
        ctx.moveTo(at.x, at.y - half)
        ctx.lineTo(at.x, at.y + half)
      }
      ctx.stroke()
      return
    }
    case "macroShape": {
      // RoundRect: $1 the corner radius, $2 to $9 the corner centres about the flash.
      const [radius, ...corners] = shape["variableValues"] as number[]
      const points = [0, 1, 2, 3].map((i) => ({ x: at.x + (corners[2 * i] as number), y: at.y + (corners[2 * i + 1] as number) }))
      ctx.lineWidth = 2 * (radius as number)
      ctx.beginPath()
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      return
    }
    default:
      throw new Error(`an aperture the test cannot draw: ${shape.type}`)
  }
}

function fromGerber(grid: Grid, text: string, asBody: boolean): Coverage {
  const read = readGerber(text)
  return drawn(grid, (ctx) => {
    if (asBody) {
      ctx.beginPath()
      for (const stroke of read.strokes) stroke.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.fill("evenodd")
      return
    }
    // Drawn in the file's order: regions, flashes and strokes interleave there, but only the pours' clear regions
    // depend on order, and they come right after their dark piece, before every pad, track and via.
    for (const region of read.regions) {
      ctx.globalCompositeOperation = region.polarity === "clear" ? "destination-out" : "source-over"
      ctx.beginPath()
      region.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.fill()
    }
    ctx.globalCompositeOperation = "source-over"
    for (const { at, aperture } of read.flashes) flash(ctx, at, aperture.shape)
    for (const stroke of read.strokes) {
      ctx.lineWidth = aperture(stroke.aperture.shape)
      ctx.beginPath()
      stroke.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }
  })
}

const aperture = (shape: Record<string, unknown>) => shape["diameter"] as number

function fromDrill(grid: Grid, text: string): Coverage {
  const read = readDrill(text)
  return drawn(grid, (ctx) => {
    for (const hole of read.holes) {
      ctx.beginPath()
      ctx.arc(hole.at.x, hole.at.y, (read.tools.get(hole.tool) as number) / 2, 0, 2 * Math.PI)
      ctx.fill()
    }
    for (const slot of read.slots) {
      ctx.lineWidth = read.tools.get(slot.tool) as number
      ctx.beginPath()
      ctx.moveTo(slot.from.x, slot.from.y)
      ctx.lineTo(slot.to.x, slot.to.y)
      ctx.stroke()
    }
  })
}

/** The share of all pixels on which the two agree (both at least half covered or both less), and of those either covers. */
function agreement(a: Coverage, b: Coverage): { all: number; covered: number } {
  let same = 0
  let either = 0
  let both = 0
  for (let i = 0; i < a.data.length; i += 1) {
    const [x, y] = [(a.data[i] as number) >= 0.5, (b.data[i] as number) >= 0.5]
    if (x === y) same += 1
    if (x || y) either += 1
    if (x && y) both += 1
  }
  return { all: same / a.data.length, covered: either === 0 ? 1 : both / either }
}

const BOARDS = [
  { folder: "../../examples/can-node", main: "can-node.circuit.tsx" },
  { folder: "../../examples/io-8", main: "io-8.circuit.tsx" },
]

describe.each(BOARDS)("each layer of $main drawn from its objects agrees with its own Gerber file", ({ folder, main }) => {
  const design = buildDesign(filesIn(fileURLToPath(new URL(folder, import.meta.url))), main)
  const outline = design.pcb.board?.outline ?? []
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const grid = gridFor({ minX: Math.min(...xs) - 1, minY: Math.min(...ys) - 1, maxX: Math.max(...xs) + 1, maxY: Math.max(...ys) + 1 }, PX_PER_MM, false)
  const layers = gerberLayers(design.pcb, design.rules.fabrication)
  const figures: string[] = []

  test.each(layers.map(({ name }) => name))("%s", (name) => {
    const layer = layers.find((one) => one.name === name)?.layer
    if (layer === undefined) throw new Error(`no layer ${name}`)
    const body = name === "Edge_Cuts"
    const ours = body ? bodyImage(grid, layer) : layerImage(grid, layer)
    const theirs = fromGerber(grid, writeGerber(layer, CREATED), body)
    const agreed = agreement(ours, theirs)
    figures.push(`${main} ${name}: ${(agreed.all * 100).toFixed(3)} % of pixels, ${(agreed.covered * 100).toFixed(2)} % of covered ones`)
    expect(agreed.all).toBeGreaterThanOrEqual(0.995)
    expect(agreed.covered).toBeGreaterThanOrEqual(0.97)
  })

  test("the plated and the non-plated drills", () => {
    const holes = drillHoles(design.pcb)
    const [plated, nonPlated] = drillFiles(design.pcb, "board", CREATED)
    for (const [list, file, kind] of [[holes.plated, plated, "PTH"], [holes.nonPlated, nonPlated, "NPTH"]] as const) {
      const agreed = agreement(holesImage(grid, list), fromDrill(grid, file?.text ?? ""))
      figures.push(`${main} ${kind}: ${(agreed.all * 100).toFixed(3)} % of pixels, ${(agreed.covered * 100).toFixed(2)} % of covered ones`)
      expect(agreed.all).toBeGreaterThanOrEqual(0.995)
      expect(agreed.covered).toBeGreaterThanOrEqual(0.97)
    }
    if (process.env["PICTURE_FIGURES"]) console.log(figures.join("\n"))
  })
})
