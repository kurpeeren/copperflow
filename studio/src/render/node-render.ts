// Draws the board or one schematic page into a PNG in Node, with the Studio's own drawing code, so an agent sees what
// the person sees: the PCB as the PCB view shows it (black canvas, layer colours, copper, pours, holes, outline,
// designators, unrouted connections), the schematic in the light sheet theme. The browser's version of the same is
// shell/print-render.ts; only the canvas differs (@napi-rs/canvas, loaded when a picture is asked for).
import type { Design } from "../../../src/engine/design.js"
import type { Ctx } from "../pcb/ctx.js"
import { PALETTE } from "../pcb/ctx.js"
import { drawPcb, worldMatrix } from "../pcb/pcb-draw.js"
import { boardFrameOf, drawReferenceLayers, referenceLayer, type ImageCtx, type MakeCanvas } from "../pcb/reference-draw.js"
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import type { DesignDiff } from "../../../src/engine/design-diff.js"
import { dimBoard, drawChangeLegend, drawChangeMarks } from "../pcb/change-draw.js"
import { drawSchematic } from "../pcb/schematic-draw.js"
import { resetSheetPalette, schematicThemeFor, setSheetPalette } from "../pcb/schematic-theme.js"
import { cameraFor, frameFor, imageSize, widthOf } from "./render-frame.js"
import { renderLook, type Angle } from "./look-render.js"
import type { LookRequest } from "../../../src/engine/fab/picture/looks.js"

export { modelGlb } from "./model-render.js"
export { stepPartFaces } from "./step-faces.js"

export interface RenderRequest {
  /** "3d": the board as made with its parts as lit simple shapes (look-render.ts). */
  view: "pcb" | "schematic" | "3d"
  /** View 3d's angle and look. */
  angle?: Angle
  look?: LookRequest
  /** The schematic page; the first one when left out. Refused for the PCB. */
  page?: string
  /** Zoom to these parts (their courtyards plus a margin) instead of the whole board or sheet. */
  parts?: string[]
  /** Width of the image in pixels, 320 to 2000; 1024 by default. The height follows the drawing's shape. */
  width?: number
  /** A change to mark over the board, dimmed, and the words the picture's line ends with. The PCB only. */
  change?: { diff: DesignDiff; caption: string }
  /** Reference images to draw under the PCB, each with its file's bytes. The PCB only. */
  underlay?: { record: ReferenceRecord; bytes: Uint8Array }[]
}

export interface Rendered {
  png: Uint8Array
  width: number
  height: number
  what: string
  /** The schematic page drawn; none for the PCB. */
  page?: string
  /** What the line names in place of the file: the design's name for view 3d. */
  label?: string
}

/** The reference images under the board, each placed by its points and drawn at its opacity. */
async function drawUnderlay(ctx: ImageCtx, underlay: NonNullable<RenderRequest["underlay"]>, pcb: Design["pcb"], view: Parameters<typeof worldMatrix>[0]): Promise<void> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas")
  const make: MakeCanvas = (width, height) => {
    const canvas = createCanvas(width, height)
    return { canvas, ctx: canvas.getContext("2d") as unknown as ImageCtx }
  }
  const board = boardFrameOf(pcb)
  const layers = []
  for (const { record, bytes } of underlay) layers.push(referenceLayer(record, await loadImage(Buffer.from(bytes)), board, make))
  drawReferenceLayers(ctx, layers, worldMatrix(view, 1))
}

/** Draws the request's view of the design into a PNG; a page for the PCB, a missing page or part, or a bad width is refused. */
export async function renderDesign(design: Design, request: RenderRequest): Promise<Rendered> {
  if (request.view === "3d") return renderLook(design, { ...(request.angle ? { angle: request.angle } : {}), ...(request.look ? { look: request.look } : {}), ...(request.width !== undefined ? { width: request.width } : {}) })
  const width = widthOf(request.width)
  const frame = frameFor(design, { ...request, view: request.view })
  const size = imageSize(frame.box, width)
  const view = { camera: cameraFor(frame.box, size), size }
  const { createCanvas } = await import("@napi-rs/canvas")
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")
  if (request.view === "pcb") {
    ctx.fillStyle = PALETTE.background
    ctx.fillRect(0, 0, size.width, size.height)
    const pcb = frame.design.pcb
    if (request.underlay) await drawUnderlay(ctx as unknown as ImageCtx, request.underlay, frame.design.pcb, view)
    drawPcb(ctx as unknown as Ctx, pcb, view, { ratio: 1, copper: { tracks: pcb.tracks, vias: pcb.vias, selected: new Set() } })
    if (request.change) {
      dimBoard(ctx as unknown as Ctx, size)
      drawChangeMarks(ctx as unknown as Ctx, view, request.change.diff, "both")
      drawChangeLegend(ctx as unknown as Ctx, size)
    }
  } else {
    const colours = schematicThemeFor("light")
    ctx.fillStyle = colours.background
    ctx.fillRect(0, 0, size.width, size.height)
    setSheetPalette(colours)
    try {
      drawSchematic(ctx as unknown as Ctx, frame.design.schematic, view, { ratio: 1 })
    } finally {
      resetSheetPalette()
    }
  }
  const png = await canvas.encode("png")
  const what = request.change ? `${frame.what}; ${request.change.caption}` : frame.what
  return { png: new Uint8Array(png), width: size.width, height: size.height, what, ...(frame.page !== undefined ? { page: frame.page } : {}) }
}
