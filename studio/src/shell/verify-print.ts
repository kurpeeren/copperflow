// Print at 1:1: a page with the footprint at its true size (an SVG sized in mm, y up as on the board) and a 10 mm
// scale bar beside it, so a person can check the printer and lay the real component on the paper. Pure.
import type { Footprint, Pad } from "../../../src/engine/footprints/types.js"
import { mm, padExtent } from "./verify-figures.js"
import { escapeXml } from "./print-page.js"

/** Paper round the drawing and between it and the scale bar, in mm. */
const MARGIN = 5
const BAR = 10

export const PRINT_NOTE = "Print at 100 % (actual size), not fit to page; the bar must measure 10 mm."

function padShape(pad: Pad): string {
  const shape =
    pad.shape === "circle" || pad.shape === "oval"
      ? `<ellipse cx="0" cy="0" rx="${mm(pad.width / 2)}" ry="${mm(pad.height / 2)}" />`
      : `<rect x="${mm(-pad.width / 2)}" y="${mm(-pad.height / 2)}" width="${mm(pad.width)}" height="${mm(pad.height)}" />`
  const drill = pad.drill === undefined ? "" : `<ellipse class="drill" cx="0" cy="0" rx="${mm(pad.drill.width / 2)}" ry="${mm(pad.drill.height / 2)}" />`
  const size = Math.max(0.3, Math.min(pad.width, pad.height) * 0.5)
  return `<g transform="translate(${mm(pad.x)} ${mm(-pad.y)}) rotate(${mm(-pad.rotation)})">${shape}${drill}</g><text x="${mm(pad.x)}" y="${mm(-pad.y + size / 3)}" font-size="${mm(size)}">${escapeXml(pad.number)}</text>`
}

/** The print page for a footprint: its pads, courtyard and origin at true size, the scale bar to the right. */
export function printFootprintHtml(title: string, footprint: Footprint): string {
  const corners = footprint.pads.flatMap((pad) => {
    const size = padExtent(pad)
    return [
      { x: pad.x - size.width / 2, y: pad.y - size.height / 2 },
      { x: pad.x + size.width / 2, y: pad.y + size.height / 2 },
    ]
  })
  const points = [...corners, ...footprint.courtyard, { x: 0, y: 0 }]
  const [minX, maxX] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...points.map((p) => -p.y)), Math.max(...points.map((p) => -p.y))]
  const left = minX - MARGIN
  const top = minY - MARGIN - 4
  const width = maxX - minX + 3 * MARGIN + BAR
  const height = Math.max(maxY - minY, 6) + 2 * MARGIN + 4
  const barX = maxX + MARGIN
  const court = footprint.courtyard.map((p) => `${mm(p.x)},${mm(-p.y)}`).join(" ")
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(width)}mm" height="${mm(height)}mm" viewBox="${mm(left)} ${mm(top)} ${mm(width)} ${mm(height)}">`,
    `<text x="${mm(left + 1)}" y="${mm(top + 3)}" font-size="2.5">${escapeXml(title)}</text>`,
    court === "" ? "" : `<polygon class="courtyard" points="${court}" />`,
    `<path class="origin" d="M -1 0 H 1 M 0 -1 V 1" />`,
    ...footprint.pads.map(padShape),
    `<rect class="scale" x="${mm(barX)}" y="${mm(minY)}" width="${BAR}" height="0.4" />`,
    `<text x="${mm(barX)}" y="${mm(minY + 3)}" font-size="2">${BAR} mm</text>`,
    "</svg>",
  ].join("")
  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"><title>${escapeXml(title)} at 1:1</title>`,
    "<style>",
    "@page { margin: 10mm }",
    "html, body { margin: 0; background: #fff; color: #000; color-scheme: light; font-family: Arial, sans-serif }",
    "p { font-size: 10pt; margin: 0 0 4mm }",
    "svg { display: block }",
    "svg g { fill: #999; stroke: #000; stroke-width: 0.05 }",
    "svg .drill { fill: #fff }",
    "svg text { fill: #000; text-anchor: start }",
    "svg g + text { text-anchor: middle }",
    "svg .courtyard, svg .origin { fill: none; stroke: #000; stroke-width: 0.05; stroke-dasharray: 0.3 0.3 }",
    "svg .scale { fill: #000 }",
    "</style></head><body>",
    `<p>${escapeXml(PRINT_NOTE)}</p>`,
    svg,
    "</body></html>",
  ].join("")
}
