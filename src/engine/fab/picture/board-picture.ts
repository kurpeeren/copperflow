// The board as made, as pixels: each layer of one side drawn by itself from the fabrication layers (the objects the
// Gerber files are written from, and the drill list), then put together (compose.ts). Pure and without a canvas, so the
// CLI, the MCP server, the export and a 3D view in the Studio can all call it; encoding it as a PNG is the caller's.
import type { PcbLayout } from "../../pcb.js"
import type { FabricationProfile } from "../../rules/schema.js"
import { drillHoles } from "../excellon.js"
import { gerberLayers } from "../layers.js"
import type { GerberLayer } from "../gerber.js"
import { compose, type SideImages } from "./compose.js"
import { bodyImage, holesImage, layerImage } from "./layer-images.js"
import { resolveLook, type Look, type LookRequest } from "./looks.js"
import { emptyCoverage, gridFor, toPixel, type Box, type Coverage, type Grid } from "./raster.js"

export type Side = "top" | "bottom"

/** What boardPicture needs of a built design. */
export interface PictureDesign {
  pcb: PcbLayout
  rules: { fabrication: FabricationProfile }
}

export interface PictureOptions {
  /** Which face, seen from its own side: the bottom is mirrored as a person sees it turning the board over. Top by default. */
  side?: Side
  look?: LookRequest
  /** Pixels per millimetre; 20 by default. */
  pxPerMm?: number
  /** The part of the board to draw, in mm; the outline's bounds by default. */
  box?: Box
}

export interface BoardPicture {
  width: number
  height: number
  /** Red, green, blue, alpha per pixel, rows from the top; alpha 0 off the board and through its holes. */
  rgba: Uint8ClampedArray
  pxPerMm: number
  mmPerPx: number
  /** The board area drawn, in mm. */
  box: Box
  /** The pixel (fractional) where the board's 0, 0 lies; x grows to the right (to the left when mirrored), y up the board is up the picture. */
  origin: { x: number; y: number }
  /** True for the bottom: board x grows to the left. */
  mirrored: boolean
  side: Side
  look: Look
}

/** The long side's limit in pixels. */
export const MAX_PICTURE_SIDE = 4000
export const DEFAULT_PX_PER_MM = 20
/** The plated wall seen down a hole, at least a pixel wide. */
const BARREL_MM = 0.05

const SIDE_LAYERS = {
  top: { copper: "F_Cu", mask: "F_Mask", paste: "F_Paste", silk: "F_Silkscreen" },
  bottom: { copper: "B_Cu", mask: "B_Mask", paste: "B_Paste", silk: "B_Silkscreen" },
} as const

const COPPER = new Set(["F_Cu", "In1_Cu", "In2_Cu", "B_Cu"])

/** The outline's bounds, or why there is nothing to draw. */
export function outlineBox(pcb: PcbLayout): Box {
  const outline = pcb.board?.outline ?? []
  if (outline.length < 3) throw new Error("The board has no outline to draw")
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function gridOf(design: PictureDesign, options: PictureOptions): Grid {
  const box = options.box ?? outlineBox(design.pcb)
  const grid = gridFor(box, options.pxPerMm ?? DEFAULT_PX_PER_MM, (options.side ?? "top") === "bottom")
  if (Math.max(grid.width, grid.height) > MAX_PICTURE_SIDE) {
    throw new Error(`The picture would be ${grid.width} x ${grid.height} px; at most ${MAX_PICTURE_SIDE} on its long side`)
  }
  return grid
}

/** Every coverage image of one side, each drawn by itself; the paste too, though a bare board shows none. */
function imagesOf(design: PictureDesign, grid: Grid, side: Side): SideImages & { paste: Coverage } {
  outlineBox(design.pcb)
  const layers = new Map<string, GerberLayer>(gerberLayers(design.pcb, design.rules.fabrication).map(({ name, layer }) => [name, layer]))
  const names = SIDE_LAYERS[side]
  const image = (name: string) => {
    const layer = layers.get(name)
    return layer === undefined ? emptyCoverage(grid) : layerImage(grid, layer)
  }
  const otherCopper = emptyCoverage(grid)
  for (const name of COPPER) {
    if (name === names.copper || !layers.has(name)) continue
    const other = image(name)
    for (let i = 0; i < other.data.length; i += 1) if ((other.data[i] as number) > (otherCopper.data[i] as number)) otherCopper.data[i] = other.data[i] as number
  }
  const outline = layers.get("Edge_Cuts")
  const holes = drillHoles(design.pcb)
  return {
    body: outline === undefined ? emptyCoverage(grid) : bodyImage(grid, outline),
    copper: image(names.copper),
    otherCopper,
    openings: image(names.mask),
    paste: image(names.paste),
    silk: image(names.silk),
    plated: holesImage(grid, holes.plated),
    bore: holesImage(grid, holes.plated, Math.max(BARREL_MM, 1 / grid.pxPerMm)),
    nonPlated: holesImage(grid, holes.nonPlated),
  }
}

/**
 * The board as made, one side, as pixels with the scale to place them: board point (x, y) in mm lies at pixel
 * (origin.x + x / mmPerPx, origin.y - y / mmPerPx), x subtracted instead when `mirrored`.
 */
export function boardPicture(design: PictureDesign, options: PictureOptions = {}): BoardPicture {
  const side = options.side ?? "top"
  const look = resolveLook(options.look)
  const grid = gridOf(design, options)
  const rgba = compose(imagesOf(design, grid, side), look, grid.pxPerMm)
  return {
    width: grid.width,
    height: grid.height,
    rgba,
    pxPerMm: grid.pxPerMm,
    mmPerPx: 1 / grid.pxPerMm,
    box: { minX: grid.minX, minY: grid.maxY - grid.height / grid.pxPerMm, maxX: grid.maxX, maxY: grid.maxY },
    origin: toPixel(grid, { x: 0, y: 0 }),
    mirrored: grid.mirrored,
    side,
    look,
  }
}

/** Each layer of one side by itself, by name, as drawn before they are put together: for looking at one alone. */
export function singleLayers(design: PictureDesign, options: Omit<PictureOptions, "look"> = {}): Record<string, Coverage> {
  const grid = gridOf(design, options)
  const images = imagesOf(design, grid, options.side ?? "top")
  return {
    body: images.body,
    copper: images.copper,
    "mask openings": images.openings,
    paste: images.paste,
    silkscreen: images.silk,
    "plated holes": images.plated,
    "unplated holes": images.nonPlated,
  }
}
