import type { Point } from "../model.js"
import { mm } from "./exposed.js"
import { centredOffsets, closedRectangle, courtyard, padExtent, SILK_CLEARANCE, tidy, type Extent } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Row letters of a ball grid, JEDEC style: A at the top, skipping I, O, Q, S, X and Z (they read as
 * digits or as each other); after Y come AA, AB, … AY, then BA and so on.
 */
const ROW_LETTERS = "ABCDEFGHJKLMNPRTUVWY"

/** The name of row `index` (0 for the top row "A"). */
export function bgaRowName(index: number): string {
  const base = ROW_LETTERS.length
  let name = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / base)) name = (ROW_LETTERS[(n - 1) % base] as string) + name
  return name
}

/**
 * The nominal ball diameter at each pitch: typical JEDEC values (MO-151, MO-195, MO-275), written
 * from general knowledge of those outlines, not transcribed from them.
 */
const BALL_BY_PITCH: ReadonlyMap<number, number> = new Map([
  [1.27, 0.75],
  [1, 0.5],
  [0.8, 0.4],
  [0.65, 0.35],
  [0.5, 0.3],
  [0.4, 0.25],
])

/**
 * IPC-7351B makes the land of a collapsing solder ball smaller than the ball: by 25% for balls of
 * 0.55 mm and more, by 20% below, rounded to the nearest 0.05 mm. These are the values as
 * remembered from the standard's BGA section, not checked against its table.
 */
const LARGE_BALL = 0.55
const LARGE_BALL_REDUCTION = 0.25
const SMALL_BALL_REDUCTION = 0.2
const LAND_ROUND_OFF = 0.05

/** IPC-7351B courtyard excess for BGAs at density level B, 1.0 mm, as remembered; round-off 0.05. */
const BGA_COURTYARD = { courtyardExcess: 1, roundOff: 0.05 }

/** The pin 1 bracket sits this far outside the silkscreen outline, with arms this long. */
const MARK_GAP = 0.3
const MARK_ARM = 1

/** Only guards against runaway strings; it is not a part limit. */
const MAX_BALLS = 4096
const SAME = 1e-9

export function bgaLand(pitch: number): { ball: number; land: number } | undefined {
  for (const [key, ball] of BALL_BY_PITCH) {
    if (Math.abs(key - pitch) > SAME) continue
    const reduction = ball >= LARGE_BALL - SAME ? LARGE_BALL_REDUCTION : SMALL_BALL_REDUCTION
    return { ball, land: tidy(Math.round((ball * (1 - reduction)) / LAND_ROUND_OFF + 1e-6) * LAND_ROUND_OFF) }
  }
  return undefined
}

/** Rows × columns: from `_rows<R>x<C>`, or the square root of the ball count. */
function grid(balls: number, rows: readonly [number, number] | undefined): { rows: number; columns: number } | undefined {
  if (rows) {
    const [r, c] = rows
    return Number.isInteger(r) && Number.isInteger(c) && r * c === balls ? { rows: r, columns: c } : undefined
  }
  const side = Math.round(Math.sqrt(balls))
  return side * side === balls ? { rows: side, columns: side } : undefined
}

function bgaPads(rows: number, columns: number, pitch: number, land: number): Pad[] {
  const xs = centredOffsets(columns, pitch)
  const ys = [...centredOffsets(rows, pitch)].reverse()
  return ys.flatMap((y, r) =>
    xs.map((x, c) => ({ number: `${bgaRowName(r)}${c + 1}`, shape: "circle" as const, x, y, width: land, height: land, rotation: 0, layers: "top" as const })),
  )
}

/** The body outline on the silkscreen, clear of the balls, and a bracket outside its top-left corner by ball A1. */
function bgaSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const extent = padExtent(pads)
  const half = { x: tidy(Math.max(body.x, extent.x + SILK_CLEARANCE)), y: tidy(Math.max(body.y, extent.y + SILK_CLEARANCE)) }
  const x = tidy(-half.x - MARK_GAP)
  const y = tidy(half.y + MARK_GAP)
  return [closedRectangle(half), [{ x, y: tidy(y - MARK_ARM) }, { x, y }, { x: tidy(x + MARK_ARM), y }]]
}

/**
 * "bga<N>_<x>x<y>_p<pitch>", optionally "_rows<R>x<C>": a full grid of N balls under a body x by y.
 * Without `_rows` the grid is square. Ball A1 is at the top left; rows run down A, B, C, … and
 * columns 1, 2, 3, … left to right.
 */
export function bgaFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const body = parsed.size
  const pitch = parsed.params["p"]
  if (parsed.kind !== "bga" || !body || typeof pitch !== "number" || Object.keys(parsed.params).length !== 1) return undefined
  if (parsed.variant !== undefined || parsed.cross !== undefined || parsed.suffix !== undefined) return undefined
  if (Object.keys(parsed.pairs ?? {}).some((key) => key !== "rows")) return undefined
  const balls = Number(parsed.code)
  const size = bgaLand(pitch)
  if (!Number.isInteger(balls) || balls < 1 || balls > MAX_BALLS || !size) return undefined
  const shape = grid(balls, parsed.pairs?.["rows"])
  if (!shape) return undefined
  const [width, height] = body
  const fits = (count: number, side: number) => (count - 1) * pitch + size.land <= side + SAME
  if (!fits(shape.columns, width) || !fits(shape.rows, height)) return undefined
  const pads = bgaPads(shape.rows, shape.columns, pitch, size.land)
  const half = { x: width / 2, y: height / 2 }
  const square = shape.rows === shape.columns
  return {
    name: `bga${balls}_${mm(width)}x${mm(height)}_p${mm(pitch)}${square ? "" : `_rows${shape.rows}x${shape.columns}`}`,
    pads,
    courtyard: courtyard(pads, half, BGA_COURTYARD),
    silkscreen: bgaSilkscreen(pads, half),
    fabrication: [closedRectangle(half)],
    origin: `IPC-7351B nominal, BGA-${balls} ${mm(width)}×${mm(height)} mm, ${mm(pitch)} mm pitch, ${shape.rows}×${shape.columns} grid, ${mm(size.ball)} mm balls on ${mm(size.land)} mm lands`,
  }
}
