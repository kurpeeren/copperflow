// File → Print… and Export → PDF…, as plain data: the page the browser prints. Each schematic page and the board is
// one sheet: an SVG the size of an A4 landscape page holding the drawing as an image (drawn by the Studio's own
// renderers, print-render.ts) and a title line, one sheet per printed page. PDF is the same page, saved through the
// browser's print dialog ("Save as PDF"), so no PDF library is needed. Pure.
import { schematicThemeFor } from "../pcb/schematic-theme.js"

/** The paper the board prints on: the light sheet's background, not the PCB view's dark one. */
export const BOARD_PAPER = (): string => schematicThemeFor("light").background

/** One drawn sheet: its image (a data URL) and what the title line says. */
export interface PrintSheet {
  title: string
  image: string
  width: number
  height: number
}

/** An A4 landscape page in mm, with a margin, as the browser prints it. */
export const PAGE_MM = { width: 297, height: 210, margin: 10 }
/** The image's pixels per mm of paper: enough for thin wires and small text at print size. */
export const PRINT_PX_PER_MM = 8

/** The image size in pixels for one printed sheet: the page less its margin and the title line. */
export function printImageSize(): { width: number; height: number } {
  return { width: (PAGE_MM.width - 2 * PAGE_MM.margin) * PRINT_PX_PER_MM, height: (PAGE_MM.height - 2 * PAGE_MM.margin - TITLE_MM) * PRINT_PX_PER_MM }
}

const TITLE_MM = 8

/** Text as it may stand in HTML and SVG. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** One sheet as SVG, in mm: the title line at the top and the drawing under it, kept to its own proportions. */
export function sheetSvg(sheet: PrintSheet): string {
  const inner = { width: PAGE_MM.width - 2 * PAGE_MM.margin, height: PAGE_MM.height - 2 * PAGE_MM.margin }
  const box = { width: inner.width, height: inner.height - TITLE_MM }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner.width}mm" height="${inner.height}mm" viewBox="0 0 ${inner.width} ${inner.height}">`,
    `<text x="0" y="5" font-size="4" font-family="Arial, sans-serif">${escapeXml(sheet.title)}</text>`,
    `<image x="0" y="${TITLE_MM}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(sheet.image)}" />`,
    `<rect x="0" y="${TITLE_MM}" width="${box.width}" height="${box.height}" fill="none" stroke="currentColor" stroke-width="0.2" />`,
    "</svg>",
  ].join("")
}

/** The whole print page: one A4 landscape sheet per drawing, printed in black on white whatever the Studio's theme. */
export function printPageHtml(title: string, sheets: readonly PrintSheet[]): string {
  const pages = sheets.map((sheet) => `<section class="sheet">${sheetSvg(sheet)}</section>`).join("")
  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"><title>${escapeXml(title)}</title>`,
    "<style>",
    `@page { size: A4 landscape; margin: ${PAGE_MM.margin}mm }`,
    "html, body { margin: 0; background: Canvas; color: CanvasText; color-scheme: light }",
    ".sheet { break-after: page; page-break-after: always }",
    ".sheet:last-child { break-after: auto; page-break-after: auto }",
    "</style></head><body>",
    pages,
    "</body></html>",
  ].join("")
}
