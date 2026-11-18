import type { Point } from "../model.js"
import { range } from "./ic.js"
import { IPC_TOLERANCES, landPattern, padRow, roundRectPad, type GoalTable, type PadRow, type Range } from "./ipc7351.js"
import { bodyOutline, centredOffsets, courtyard, padExtent, SILK_CLEARANCE, tidy, type Extent } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * A PLCC: J-leads at 1.27 mm on four sides. `across` is the top and bottom sides (x), `upright` the
 * left and right sides (y). For each: leads per side, the overall size over the leads (D or E) and
 * the body (D1 or E1).
 */
interface PlccSide {
  leads: number
  span: Range
  body: Range
}

interface Plcc {
  across: PlccSide
  upright: PlccSide
}

const PITCH = 1.27
/** Lead width b, JEDEC MS-016 / MS-018: 0.33–0.53 mm. */
const LEAD_WIDTH = range(0.33, 0.53)
/**
 * How far the J-lead's contact with the board reaches in from the outside of the lead, taken as
 * 1.00–1.50 mm. This is a choice made here from the usual JEDEC lead form, not a drawing value.
 */
const CONTACT = range(1.0, 1.5)

/**
 * Square PLCCs, JEDEC MS-018 (MO-047), and the rectangular PLCC-32, JEDEC MS-016 (MO-052), in the
 * inch-controlled dimensions those outlines give, converted to mm: overall D/E over the leads and body
 * D1/E1. Written from general knowledge of those outlines, not transcribed from them; a part's own
 * drawing should confirm.
 */
const square = (leads: number, span: Range, body: Range): Plcc => {
  const side = { leads: leads / 4, span, body }
  return { across: side, upright: side }
}

const PACKAGES = new Map<string, Plcc>([
  ["20", square(20, range(9.78, 10.03), range(8.89, 9.04))],
  ["28", square(28, range(12.32, 12.57), range(11.43, 11.58))],
  ["44", square(44, range(17.4, 17.65), range(16.51, 16.66))],
  ["52", square(52, range(19.94, 20.19), range(19.05, 19.2))],
  ["68", square(68, range(25.02, 25.27), range(24.13, 24.28))],
  ["84", square(84, range(30.1, 30.35), range(29.21, 29.36))],
  [
    "32",
    {
      across: { leads: 7, span: range(12.32, 12.57), body: range(11.35, 11.51) },
      upright: { leads: 9, span: range(14.86, 15.11), body: range(13.89, 14.05) },
    },
  ],
])

/**
 * J-lead goals, level B: toe (outside, the Z side) 0.35, heel (under the body, the G side) 0,
 * side 0.03; round-off 0.05 mm; courtyard excess 0.25. Written from general knowledge of the
 * IPC-7351B J-lead table, not checked against it: no source for that table was at hand.
 */
const J_LEAD_TABLE: Readonly<GoalTable> = Object.freeze({
  goals: Object.freeze({ toe: 0.35, heel: 0, side: 0.03 }),
  roundOff: 0.05,
  courtyardExcess: 0.25,
})

function jLeadRow(side: PlccSide): PadRow {
  const lead = { span: side.span, terminal: CONTACT, width: LEAD_WIDTH }
  return padRow(landPattern(lead, J_LEAD_TABLE.goals, IPC_TOLERANCES), J_LEAD_TABLE.roundOff)
}

/**
 * Pad 1 in the middle of the top side; the numbers then run counter-clockwise seen from the top, as
 * the JEDEC outlines number them: leftwards along the top to its left end, down the left side, along
 * the bottom left to right, up the right side, and leftwards along the top back to pad 1. The last pad
 * sits just right of pad 1.
 */
function plccPads(pkg: Plcc): Pad[] {
  const top = jLeadRow(pkg.upright)
  const side = jLeadRow(pkg.across)
  const xs = centredOffsets(pkg.across.leads, PITCH)
  const ys = centredOffsets(pkg.upright.leads, PITCH)
  const across = (x: number, y: number) => ({ x, y, width: top.width, height: top.length })
  const upright = (x: number, y: number) => ({ x, y, width: side.length, height: side.width })
  const ring = [
    ...[...xs].reverse().map((x) => across(x, top.centre)),
    ...[...ys].reverse().map((y) => upright(-side.centre, y)),
    ...xs.map((x) => across(x, -top.centre)),
    ...ys.map((y) => upright(side.centre, y)),
  ]
  const start = (pkg.across.leads - 1) / 2
  const ordered = [...ring.slice(start), ...ring.slice(0, start)]
  return ordered.map((p, i) => roundRectPad(String(i + 1), p.x, p.y, p.width, p.height))
}

/** An L at each body corner, clear of the pads, and a short bar above pad 1 to mark it. */
function plccSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const ends = { x: Math.max(...pads.filter((p) => p.height > p.width).map((p) => Math.abs(p.x) + p.width / 2)), y: 0 }
  const reachY = Math.max(...pads.filter((p) => p.width > p.height).map((p) => Math.abs(p.y) + p.height / 2))
  const startX = tidy(ends.x + SILK_CLEARANCE)
  const startY = tidy(reachY + SILK_CLEARANCE)
  const cx = tidy(Math.max(body.x, startX))
  const cy = tidy(Math.max(body.y, startY))
  const corner = (sx: number, sy: number): Point[] => [
    { x: tidy(sx * startX), y: tidy(sy * cy) },
    { x: tidy(sx * cx), y: tidy(sy * cy) },
    { x: tidy(sx * cx), y: tidy(sy * startY) },
  ]
  const first = pads[0] as Pad
  const above = tidy(padExtent(pads).y + SILK_CLEARANCE)
  const mark = [{ x: tidy(first.x - first.width / 2), y: above }, { x: tidy(first.x + first.width / 2), y: above }]
  return [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1), mark]
}

const SIZES = [...PACKAGES.keys()].map(Number).sort((a, b) => a - b)

/** The IPC-7351B nominal footprint for "plcc<N>", N one of 20, 28, 32, 44, 52, 68, 84; a refusal for another N; or undefined. */
export function plccFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "plcc") return undefined
  const pkg = PACKAGES.get(parsed.code)
  if (!pkg) return refuse(`a PLCC has ${SIZES.slice(0, -1).join(", ")} or ${SIZES[SIZES.length - 1]} pins`)
  if (!isSimple(parsed) || parsed.variant !== undefined || Object.keys(parsed.params).length > 0) return refuse("a PLCC takes no variant or parameters")
  const pads = plccPads(pkg)
  const body = { x: pkg.across.body.max / 2, y: pkg.upright.body.max / 2 }
  const component = { x: pkg.across.span.max / 2, y: pkg.upright.span.max / 2 }
  const label = parsed.code === "32" ? "PLCC-32 (JEDEC MS-016)" : `PLCC-${parsed.code} (JEDEC MS-018)`
  return {
    name: `plcc${parsed.code}`,
    pads,
    courtyard: courtyard(pads, component, J_LEAD_TABLE),
    silkscreen: plccSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${label}, J-lead goals from general knowledge`,
  }
}
