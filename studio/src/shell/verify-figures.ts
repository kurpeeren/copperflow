// The Verify screen's table of figures: what a land pattern drawing gives, read from the pads the build uses. Only the
// figures that mean something for the arrangement are given: two pads have a gap and no pitch, one row has no rows,
// pads of several sizes are listed by size with their numbers. Every figure in mm with three decimals at most. Pure.
import type { Pad } from "../../../src/engine/footprints/types.js"

export interface Figure {
  label: string
  value: string
}

/** Positions closer than this are one row (mm). */
const SAME = 1e-3

/** A length in mm with three decimals at most, trailing zeros dropped. */
export function mm(value: number): string {
  const rounded = Number(value.toFixed(3))
  return String(rounded === 0 ? 0 : rounded)
}

const length = (value: number) => `${mm(value)} mm`
const area = (a: number, b: number) => `${mm(a)} × ${mm(b)} mm`

/** Pad numbers in order, three or more in a row written as a run: "1–3, 7, 9–11". */
export function padNumbers(numbers: readonly string[]): string {
  const sorted = [...new Set(numbers)].sort(byNumber)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let end = i
    while (end + 1 < sorted.length && Number(sorted[end + 1]) === Number(sorted[end]) + 1) end++
    parts.push(end - i >= 2 ? `${sorted[i]}–${sorted[end]}` : sorted.slice(i, end + 1).join(", "))
    i = end + 1
  }
  return parts.join(", ")
}

export function byNumber(a: string, b: string): number {
  const [x, y] = [Number(a), Number(b)]
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b)
}

/** The pad's extent along x and y on the board, after its rotation. */
export function padExtent(pad: Pick<Pad, "width" | "height" | "rotation">): { width: number; height: number } {
  const angle = (pad.rotation * Math.PI) / 180
  const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))]
  return { width: pad.width * cos + pad.height * sin, height: pad.width * sin + pad.height * cos }
}

export function landPatternFigures(pads: readonly Pad[]): Figure[] {
  if (pads.length === 0) return [{ label: "Pads", value: "0" }]
  return [{ label: "Pads", value: String(pads.length) }, ...sizeFigures(pads), ...arrangementFigures(pads), ...drillFigures(pads)]
}

function sizeFigures(pads: readonly Pad[]): Figure[] {
  const groups = groupBy(pads, (pad) => {
    const size = padExtent(pad)
    return area(size.width, size.height)
  })
  if (groups.size === 1) return [{ label: "Pad width × height", value: [...groups.keys()][0] ?? "" }]
  return [...groups].map(([value, members]) => {
    const numbers = [...new Set(members.map((pad) => pad.number))]
    return { label: `Pad width × height, pad${numbers.length === 1 ? "" : "s"} ${padNumbers(numbers)}`, value }
  })
}

function drillFigures(pads: readonly Pad[]): Figure[] {
  const drilled = pads.filter((pad) => pad.drill !== undefined)
  if (drilled.length === 0) return []
  const groups = groupBy(drilled, (pad) => {
    const drill = pad.drill ?? { width: 0, height: 0 }
    return drill.width === drill.height ? length(drill.width) : `${area(drill.width, drill.height)} (slot)`
  })
  const label = (base: string, members: Pad[]) => (groups.size === 1 ? base : `${base}, pads ${padNumbers(members.map((pad) => pad.number))}`)
  return [...groups].flatMap(([value, members]) => [
    { label: label("Drill", members), value },
    { label: label("Annular ring", members), value: length(Math.min(...members.map(annularRing))) },
  ])
}

/** The narrowest copper round the hole. */
function annularRing(pad: Pad): number {
  const drill = pad.drill ?? { width: 0, height: 0 }
  return Math.min(pad.width - drill.width, pad.height - drill.height) / 2
}

type Axis = "x" | "y"
const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x")
const half = (pad: Pad, axis: Axis) => (axis === "x" ? padExtent(pad).width : padExtent(pad).height) / 2

/** From the outer edge of the first pad to the outer edge of the last, along an axis. */
function span(pads: readonly Pad[], axis: Axis): number {
  return Math.max(...pads.map((pad) => pad[axis] + half(pad, axis))) - Math.min(...pads.map((pad) => pad[axis] - half(pad, axis)))
}

function arrangementFigures(pads: readonly Pad[]): Figure[] {
  if (pads.length === 1) return []
  if (pads.length === 2) return twoPads(pads[0] as Pad, pads[1] as Pad)
  const rowsAlong = (axis: Axis) => lines(pads, other(axis))
  const [alongX, alongY] = [rowsAlong("x"), rowsAlong("y")]
  // One row: all pads share a y (a row along x) or an x.
  for (const axis of ["x", "y"] as const) {
    if (rowsAlong(axis).length === 1) return [{ label: "Pitch along", value: pitches(pads, axis) }, { label: "Span outside the pads", value: length(span(pads, axis)) }]
  }
  // Two rows: the rows along the axis whose rows hold the most pads.
  const two = (alongY.length === 2 ? ["y"] : []).concat(alongX.length === 2 ? ["x"] : []) as Axis[]
  if (two.length > 0) {
    const axis = two.sort((a, b) => Math.max(...rowsAlong(b).map((row) => row.length)) - Math.max(...rowsAlong(a).map((row) => row.length)))[0] as Axis
    const [first, second] = rowsAlong(axis) as [Pad[], Pad[]]
    const across = other(axis)
    return [
      { label: "Pitch along", value: pitches(pads, axis) },
      { label: "Rows centre to centre", value: length(Math.abs((second[0] as Pad)[across] - (first[0] as Pad)[across])) },
      { label: "Span outside the pads", value: length(span(pads, across)) },
    ]
  }
  const grid = gridFigures(pads, alongX, alongY)
  if (grid) return grid
  return quadFigures(pads) ?? [
    { label: "Pitch along", value: pitches(longestLine(pads), longestAxis(pads)) },
    { label: "Span outside the pads", value: area(span(pads, "x"), span(pads, "y")) },
  ]
}

function twoPads(a: Pad, b: Pad): Figure[] {
  const along: Axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "x" : "y"
  return [
    { label: "Pads centre to centre", value: length(Math.hypot(b.x - a.x, b.y - a.y)) },
    { label: "Gap between the pads", value: length(edgeGap(a, b)) },
    { label: "Span outside the pads", value: length(span([a, b], along)) },
  ]
}

/** Three rows or more, every row the same: a pitch each way. */
function gridFigures(pads: readonly Pad[], alongX: Pad[][], alongY: Pad[][]): Figure[] | undefined {
  const even = (rows: Pad[][]) => rows.every((row) => row.length === rows[0]?.length)
  if (!even(alongX) || !even(alongY) || alongX.length * alongY.length !== pads.length) return undefined
  return [
    { label: "Pitch along", value: pitches(pads, "x") },
    { label: "Pitch across", value: pitches(pads, "y") },
    { label: "Span outside the pads", value: area(span(pads, "x"), span(pads, "y")) },
  ]
}

/** Pads on four sides (a QFN or QFP), with anything else inside them (an exposed pad). */
function quadFigures(pads: readonly Pad[]): Figure[] | undefined {
  const at = (axis: Axis, value: number) => pads.filter((pad) => Math.abs(pad[axis] - value) < SAME)
  const xs = pads.map((pad) => pad.x)
  const ys = pads.map((pad) => pad.y)
  const [left, right, bottom, top] = [at("x", Math.min(...xs)), at("x", Math.max(...xs)), at("y", Math.min(...ys)), at("y", Math.max(...ys))]
  if ([left, right, bottom, top].some((side) => side.length < 2)) return undefined
  const sides = new Set([...left, ...right, ...bottom, ...top])
  // A pad in a corner belongs to two sides: that is a frame of pads, not four rows.
  if (sides.size !== left.length + right.length + bottom.length + top.length) return undefined
  const inside = (pad: Pad) => pad.x > Math.min(...xs) + SAME && pad.x < Math.max(...xs) - SAME && pad.y > Math.min(...ys) + SAME && pad.y < Math.max(...ys) - SAME
  if (pads.some((pad) => !sides.has(pad) && !inside(pad))) return undefined
  const spacing = distinct([...neighbourSpacings(left, "y"), ...neighbourSpacings(right, "y"), ...neighbourSpacings(bottom, "x"), ...neighbourSpacings(top, "x")])
  return [
    { label: "Pitch along", value: spacing },
    { label: "Rows centre to centre", value: area(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) },
    { label: "Span outside the pads", value: area(span(pads, "x"), span(pads, "y")) },
  ]
}

/** The pads in rows: those that share a position on `axis` (a row along the other axis). */
function lines(pads: readonly Pad[], axis: Axis): Pad[][] {
  const rows: Pad[][] = []
  for (const pad of [...pads].sort((a, b) => a[axis] - b[axis])) {
    const last = rows.at(-1)
    if (last && Math.abs((last[0] as Pad)[axis] - pad[axis]) < SAME) last.push(pad)
    else rows.push([pad])
  }
  return rows
}

/** The spacings between neighbours along `axis` inside each row, each distinct value once: "1, 1.2 mm". */
function pitches(pads: readonly Pad[], axis: Axis): string {
  return distinct(lines(pads, other(axis)).flatMap((row) => neighbourSpacings(row, axis)))
}

function neighbourSpacings(row: readonly Pad[], axis: Axis): number[] {
  const sorted = row.map((pad) => pad[axis]).sort((a, b) => a - b)
  return sorted.slice(1).map((value, i) => value - (sorted[i] as number)).filter((step) => step > SAME)
}

function distinct(values: readonly number[]): string {
  const shown = [...new Set(values.map(mm))].sort((a, b) => Number(a) - Number(b))
  return shown.length === 0 ? "–" : `${shown.join(", ")} mm`
}

function longestAxis(pads: readonly Pad[]): Axis {
  const longest = (axis: Axis) => Math.max(...lines(pads, other(axis)).map((row) => row.length))
  return longest("x") >= longest("y") ? "x" : "y"
}

function longestLine(pads: readonly Pad[]): Pad[] {
  const axis = longestAxis(pads)
  return lines(pads, other(axis)).reduce((best, row) => (row.length > best.length ? row : best), [] as Pad[])
}

/** The distance between the nearest edges of two pads; round pads are measured round. */
export function edgeGap(a: Pad, b: Pad): number {
  const round = (pad: Pad) => pad.shape === "circle" && pad.width === pad.height
  if (round(a) && round(b)) return Math.max(0, Math.hypot(b.x - a.x, b.y - a.y) - a.width / 2 - b.width / 2)
  const gx = Math.max(0, Math.abs(b.x - a.x) - half(a, "x") - half(b, "x"))
  const gy = Math.max(0, Math.abs(b.y - a.y) - half(a, "y") - half(b, "y"))
  return Math.hypot(gx, gy)
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}
