// Draws each schematic page and the board into an image for File → Print… and Export → PDF… (print-page.ts lays them
// out), with the same renderers the canvases use: the schematic in the light theme, as paper is, and the board as the
// PCB view shows it. Then opens the print page in a new window and asks the browser to print it.
import type { Design } from "../api"
import { drawingExtents } from "../pcb/drawing-extents"
import { fitCamera, pointBounds, unionBoxes, type Box, type Camera, type Size } from "../pcb/geometry"
import { drawPcb } from "../pcb/pcb-draw"
import { drawSchematic } from "../pcb/schematic-draw"
import { schematicThemeFor, setSheetPalette } from "../pcb/schematic-theme"
import { printImageSize, printPageHtml, type PrintSheet } from "./print-page"
import { designOnPage, pageNames } from "./schematic-pages"
import { parseTheme, type ThemeName } from "./theme-state"

const MARGIN = 0.04

/** A canvas of `size`, filled with `background`, and its context; undefined where the browser gives none. */
function blank(size: Size, background: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined
  ctx.fillStyle = background
  ctx.fillRect(0, 0, size.width, size.height)
  return { canvas, ctx }
}

/** One schematic page drawn on white paper, fitted to the sheet. */
function sheetImage(design: Design, page: string, size: Size): string | undefined {
  const layout = designOnPage(design, page).schematic
  const box = drawingExtents(layout)
  const colours = schematicThemeFor("light")
  const drawn = box && blank(size, colours.background)
  if (!box || !drawn) return undefined
  setSheetPalette(colours)
  drawSchematic(drawn.ctx, layout, { camera: fitCamera(box, size, MARGIN), size }, { ratio: 1 })
  return drawn.canvas.toDataURL("image/png")
}

/** The paper the board prints on: the light sheet's background, not the PCB view's dark one. */
export const BOARD_PAPER = (): string => schematicThemeFor("light").background

/** The board drawn in the PCB view's layer colours on paper, its tracks and vias with it, fitted to the sheet. */
function boardImage(design: Design, size: Size): string | undefined {
  const pcb = design.pcb
  const box: Box | undefined = pointBounds(pcb.board?.outline ?? []) ?? unionBoxes(pcb.parts.map((part) => ({ minX: part.x - 1, minY: part.y - 1, maxX: part.x + 1, maxY: part.y + 1 })))
  const drawn = box && blank(size, BOARD_PAPER())
  if (!box || !drawn) return undefined
  const camera: Camera = fitCamera(box, size, MARGIN)
  drawPcb(drawn.ctx, pcb, { camera, size }, { ratio: 1, copper: { tracks: pcb.tracks, vias: pcb.vias, selected: new Set() } })
  return drawn.canvas.toDataURL("image/png")
}

/** Every schematic page and the board, as print sheets; the sheet palette goes back to the Studio's theme after. */
export function printSheets(design: Design, file: string, theme: ThemeName = parseTheme(document.documentElement.getAttribute("data-theme"))): PrintSheet[] {
  const size = printImageSize()
  const sheets: PrintSheet[] = []
  try {
    for (const page of pageNames(design)) {
      const image = sheetImage(design, page, size)
      if (image) sheets.push({ title: `${file} · Schematic · ${page}`, image, ...size })
    }
  } finally {
    setSheetPalette(schematicThemeFor(theme))
  }
  const board = boardImage(design, size)
  if (board) sheets.push({ title: `${file} · PCB`, image: board, ...size })
  return sheets
}

/** Opens the print page in a new window and starts the browser's print; false when the window could not open. */
export function openPrint(title: string, sheets: readonly PrintSheet[]): boolean {
  const view = window.open("", "_blank")
  if (!view) return false
  view.document.open()
  view.document.write(printPageHtml(title, sheets))
  view.document.close()
  view.focus()
  // The images are data URLs, so they are there once the document is; print after the page has laid them out.
  view.setTimeout(() => view.print(), 0)
  return true
}
