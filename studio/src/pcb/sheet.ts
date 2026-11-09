// The schematic sheet's drawing border: the paper size that holds the drawing, the zone labels in the band inside the
// outer line, and the title block in the bottom-right corner. Pure geometry in sheet units (inches); sheet-draw.ts paints it.
import type { Box } from "./geometry.js"

export interface SheetSize {
  name: string
  width: number
  height: number
  /** Zones across and down. */
  zonesX: number
  zonesY: number
}

/** The standard landscape sizes, smallest first. */
export const SHEET_SIZES: readonly SheetSize[] = [
  { name: "A4", width: 11.69, height: 8.27, zonesX: 6, zonesY: 4 },
  { name: "A3", width: 16.54, height: 11.69, zonesX: 8, zonesY: 6 },
  { name: "A2", width: 23.39, height: 16.54, zonesX: 12, zonesY: 8 },
  { name: "A1", width: 33.11, height: 23.39, zonesX: 16, zonesY: 12 },
  { name: "A0", width: 46.81, height: 33.11, zonesX: 24, zonesY: 16 },
]

/** Free paper kept round the drawing on every side. */
export const SHEET_MARGIN = 0.5
/** The zone-label band between the outer and the inner line. */
export const ZONE_BAND = 0.2
export const TITLE_BLOCK_WIDTH = 4.0
export const TITLE_BLOCK_HEIGHT = 1.2
const LABEL_COLUMN = 0.8
const GRID_STEPS_PER_INCH = 10

export interface Sheet {
  size: SheetSize
  /** The outer line. */
  outer: Box
  /** The inner line, ZONE_BAND inside the outer one. */
  inner: Box
}

/** Rounds to the 0.1 grid; dividing by 10 at the end avoids the float noise of multiplying by 0.1. */
function snapToGrid(value: number): number {
  return Math.round(value * GRID_STEPS_PER_INCH) / GRID_STEPS_PER_INCH
}

/** The smallest sheet that holds `extents` plus the margin (the largest if none does), centred on them; an empty sheet is centred on the origin. */
export function sheetFor(extents: Box | undefined): Sheet {
  const box = extents ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const needW = box.maxX - box.minX + 2 * SHEET_MARGIN
  const needH = box.maxY - box.minY + 2 * SHEET_MARGIN
  const size = SHEET_SIZES.find((s) => s.width >= needW && s.height >= needH) ?? (SHEET_SIZES[SHEET_SIZES.length - 1] as SheetSize)
  const minX = snapToGrid((box.minX + box.maxX) / 2 - size.width / 2)
  const minY = snapToGrid((box.minY + box.maxY) / 2 - size.height / 2)
  const outer = { minX, minY, maxX: minX + size.width, maxY: minY + size.height }
  const inner = { minX: outer.minX + ZONE_BAND, minY: outer.minY + ZONE_BAND, maxX: outer.maxX - ZONE_BAND, maxY: outer.maxY - ZONE_BAND }
  return { size, outer, inner }
}

export interface ZoneLabel {
  text: string
  x: number
  y: number
}

/** 1, 2, 3 across the top and bottom, A, B, C down the left and right, each centred in its zone inside the band. */
export function zoneLabels(sheet: Sheet): ZoneLabel[] {
  const { size, inner, outer } = sheet
  const labels: ZoneLabel[] = []
  const stepX = (inner.maxX - inner.minX) / size.zonesX
  const stepY = (inner.maxY - inner.minY) / size.zonesY
  for (let i = 0; i < size.zonesX; i++) {
    const x = inner.minX + (i + 0.5) * stepX
    labels.push({ text: String(i + 1), x, y: (outer.minY + inner.minY) / 2 }, { text: String(i + 1), x, y: (outer.maxY + inner.maxY) / 2 })
  }
  for (let j = 0; j < size.zonesY; j++) {
    const y = inner.minY + (j + 0.5) * stepY
    const text = String.fromCharCode(65 + j)
    labels.push({ text, x: (outer.minX + inner.minX) / 2, y }, { text, x: (outer.maxX + inner.maxX) / 2, y })
  }
  return labels
}

/** The lines between zones, across the band: x of the vertical ones and y of the horizontal ones. */
export function zoneDividers(sheet: Sheet): { xs: number[]; ys: number[] } {
  const { size, inner } = sheet
  const at = (from: number, to: number, count: number) => Array.from({ length: count - 1 }, (_, i) => from + ((i + 1) * (to - from)) / count)
  return { xs: at(inner.minX, inner.maxX, size.zonesX), ys: at(inner.minY, inner.maxY, size.zonesY) }
}

export interface TitleValues {
  project: string
  page: string
  file: string
  date: string
  rev: string
}

export interface TitleCell {
  box: Box
  text: string
  kind: "label" | "value"
}

export interface TitleBlock {
  box: Box
  cells: TitleCell[]
}

const ROWS: ReadonlyArray<[string, keyof TitleValues]> = [
  ["Project", "project"],
  ["Page", "page"],
  ["File", "file"],
  ["Date", "date"],
  ["Rev", "rev"],
]

/** The title block in the bottom-right corner of the inner line: a label cell and a value cell on each of its five rows. */
export function titleBlock(sheet: Sheet, values: TitleValues): TitleBlock {
  const { inner } = sheet
  const box = { minX: inner.maxX - TITLE_BLOCK_WIDTH, minY: inner.maxY - TITLE_BLOCK_HEIGHT, maxX: inner.maxX, maxY: inner.maxY }
  const rowHeight = TITLE_BLOCK_HEIGHT / ROWS.length
  const split = box.minX + LABEL_COLUMN
  const cells = ROWS.flatMap(([label, key], i): TitleCell[] => {
    const minY = box.minY + i * rowHeight
    const maxY = minY + rowHeight
    return [
      { box: { minX: box.minX, minY, maxX: split, maxY }, text: label, kind: "label" },
      { box: { minX: split, minY, maxX: box.maxX, maxY }, text: values[key], kind: "value" },
    ]
  })
  return { box, cells }
}

/** The build's finish time as YYYY-MM-DD; empty when there is no build or the time is not ISO. */
export function sheetDate(finishedAt: string | undefined): string {
  return finishedAt && /^\d{4}-\d{2}-\d{2}/.test(finishedAt) ? finishedAt.slice(0, 10) : ""
}
