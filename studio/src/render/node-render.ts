// Draws the board or one schematic page into a PNG in Node, with the Studio's own drawing code, so an agent sees what
// the person sees: the PCB as the PCB view shows it (black canvas, layer colours, copper, pours, holes, outline,
// designators, unrouted connections), the schematic in the light sheet theme. The browser's version of the same is
// shell/print-render.ts; only the canvas differs (@napi-rs/canvas, loaded when a picture is asked for).
import type { Design } from "../../../src/engine/design.js"
import type { Ctx } from "../pcb/ctx.js"
import { PALETTE } from "../pcb/ctx.js"
import { drawPcb } from "../pcb/pcb-draw.js"
import { drawSchematic } from "../pcb/schematic-draw.js"
import { resetSheetPalette, schematicThemeFor, setSheetPalette } from "../pcb/schematic-theme.js"
import { cameraFor, frameFor, imageSize, widthOf } from "./render-frame.js"

export interface RenderRequest {
  view: "pcb" | "schematic"
  /** The schematic page; the first one when left out. Refused for the PCB. */
  page?: string
  /** Zoom to these parts (their courtyards plus a margin) instead of the whole board or sheet. */
  parts?: string[]
  /** Width of the image in pixels, 320 to 2000; 1024 by default. The height follows the drawing's shape. */
  width?: number
}

export interface Rendered {
  png: Uint8Array
  width: number
  height: number
  what: string
  /** The schematic page drawn; none for the PCB. */
  page?: string
}

/** Draws the request's view of the design into a PNG; a page for the PCB, a missing page or part, or a bad width is refused. */
export async function renderDesign(design: Design, request: RenderRequest): Promise<Rendered> {
  const width = widthOf(request.width)
  const frame = frameFor(design, request)
  const size = imageSize(frame.box, width)
  const view = { camera: cameraFor(frame.box, size), size }
  const { createCanvas } = await import("@napi-rs/canvas")
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")
  if (request.view === "pcb") {
    ctx.fillStyle = PALETTE.background
    ctx.fillRect(0, 0, size.width, size.height)
    const pcb = frame.design.pcb
    drawPcb(ctx as unknown as Ctx, pcb, view, { ratio: 1, copper: { tracks: pcb.tracks, vias: pcb.vias, selected: new Set() } })
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
  return { png: new Uint8Array(png), width: size.width, height: size.height, what: frame.what, ...(frame.page !== undefined ? { page: frame.page } : {}) }
}
