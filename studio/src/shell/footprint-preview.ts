// Library → New part…: the footprint string's pads, courtyard, silkscreen and body from copperflow's own generator,
// scaled into a small canvas (y down). Pure; the dialog draws what this returns.
import { generateFootprint } from "../../../src/engine/footprints/index.js"
import type { Pad } from "../../../src/engine/footprints/types.js"
import type { Point } from "../../../src/engine/model.js"

export interface PreviewPad {
  number: string
  shape: Pad["shape"]
  /** Centre on the canvas, in canvas pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees clockwise on the canvas (the generator's are counter-clockwise with y up). */
  rotation: number
  through: boolean
  /** The hole's diameter on the canvas (the smaller side of a slot). */
  drill?: number
}

export interface FootprintPreview {
  pads: PreviewPad[]
  courtyard: Point[]
  silkscreen: Point[][]
  body: Point[][]
  /** Canvas pixels per mm. */
  scale: number
  /** "8 pads, courtyard 5.9 × 5.5 mm". */
  summary: string
}

export const PREVIEW_HINT = "Type a footprint string such as soic8, qfn32_5x5_p0.5 or hc49s."

/** Free space around the drawing, in canvas pixels. */
const MARGIN = 10

export function footprintPreview(text: string, size: { width: number; height: number }): FootprintPreview | { error: string } {
  const name = text.trim()
  if (name === "") return { error: PREVIEW_HINT }
  // A path would read a file; the preview draws generated footprints only.
  if (name.includes("/")) return { error: `"${name}" is not a footprint string` }
  const footprint = generateFootprint(name)
  if ("error" in footprint) return { error: footprint.error }
  const points = [...footprint.courtyard, ...footprint.silkscreen.flat(), ...footprint.fabrication.flat(), ...footprint.pads.flatMap(corners)]
  const box = bounds(points)
  const scale = Math.min((size.width - 2 * MARGIN) / Math.max(box.width, 1e-6), (size.height - 2 * MARGIN) / Math.max(box.height, 1e-6))
  const toCanvas = (p: Point): Point => ({ x: size.width / 2 + (p.x - box.cx) * scale, y: size.height / 2 - (p.y - box.cy) * scale })
  const pads = footprint.pads.map((pad): PreviewPad => {
    const centre = toCanvas(pad)
    return {
      number: pad.number,
      shape: pad.shape,
      x: centre.x,
      y: centre.y,
      width: pad.width * scale,
      height: pad.height * scale,
      rotation: -pad.rotation,
      through: pad.layers === "through",
      ...(pad.drill ? { drill: Math.min(pad.drill.width, pad.drill.height) * scale } : {}),
    }
  })
  const court = bounds(footprint.courtyard)
  const padCount = footprint.pads.length
  return {
    pads,
    courtyard: footprint.courtyard.map(toCanvas),
    silkscreen: footprint.silkscreen.map((line) => line.map(toCanvas)),
    body: footprint.fabrication.map((line) => line.map(toCanvas)),
    scale,
    summary: `${padCount} pad${padCount === 1 ? "" : "s"}, courtyard ${mm(court.width)} × ${mm(court.height)} mm`,
  }
}

/** The pad's corners in mm, turned by its rotation, so a turned pad stays inside the drawing. */
function corners(pad: Pad): Point[] {
  const [w, h] = [pad.width / 2, pad.height / 2]
  const angle = (pad.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x = 0, y = 0]) => ({ x: pad.x + x * cos - y * sin, y: pad.y + x * sin + y * cos }))
}

function bounds(points: readonly Point[]): { width: number; height: number; cx: number; cy: number } {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return { width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

const mm = (value: number) => Number(value.toFixed(2))
