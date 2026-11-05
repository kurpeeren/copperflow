/**
 * IPC-7351B land patterns: the equations, the solder joint goals they use and the two-terminal pad
 * that comes out of them. Lengths are in mm. Every constant names its source.
 *
 * Sources cited below:
 * - [IPC-7351B] IPC-7351B, "Generic Requirements for Surface Mount Design and Land Pattern Standard",
 *   June 2010. Table numbers and pages as listed in its table of contents
 *   (https://www.ipc.org/TOC/IPC-7351B.pdf).
 * - [IPC-7351] IPC-7351, same title, February 2005 (the edition IPC-7351B revises).
 * - [PCBL-2025] PCB Libraries, Inc., "PCB Design Perfection Starts in the CAD Library", PCEA, 2025,
 *   https://pcea.net/wp-content/uploads/2025/09/PCB-Design-Perfection-Starts-in-the-CAD-Library.pdf
 * - [PCBL-2587] PCB Libraries Forum, "IPC-J-STD-001 Gull Wing Leads and Solder Joints", Tom H,
 *   26 Dec 2019, https://www.pcblibraries.com/forum/printer_friendly_posts.asp?TID=2587
 * - [PCBL-2588] PCB Libraries Forum, "IPC-J-STD-001 Chip Component Solder Joints", Tom H,
 *   27 Dec 2019, https://www.pcblibraries.com/forum/printer_friendly_posts.asp?TID=2588
 * - [PCBL-1744] PCB Libraries Forum, "Dimensional Principles of IPC-7351B", 2015–2025,
 *   https://www.pcblibraries.com/forum/printer_friendly_posts.asp?TID=1744
 * - [PCBL-30] PCB Libraries Forum, "0402 Min Size Land Pattern", Library Expert Lite output posted
 *   by jayx, 20 Apr 2015, https://www.pcblibraries.com/FORUM/printer_friendly_posts.asp?TID=30
 */
import type { Pad } from "./types.js"

export interface Range {
  min: number
  max: number
}

export interface FilletGoals {
  toe: number
  heel: number
  side: number
}

export interface Tolerances {
  fabrication: number
  placement: number
}

/** Outer pad extent Z, inner gap G and pad width X, before rounding. */
export interface LandPattern {
  Z: number
  G: number
  X: number
}

/** A row of terminals measured as IPC-7351 does: toe-to-toe span L, terminal length T, width W. */
export interface Lead {
  span: Range
  terminal: Range
  width: Range
}

/**
 * The IPC-7351B equations ([IPC-7351] §3.1.5, p. 10):
 *   Z = Lmin + 2·Jt + √(CL² + F² + P²)
 *   G = Smax' − 2·Jh − √(CSrms² + F² + P²)
 *   X = Wmin + 2·Js + √(CW² + F² + P²)
 * with Smin = Lmin − 2·Tmax, Smax = Lmax − 2·Tmin and CSrms = √(CL² + 2·CT²). Half of the
 * difference between the worst-case and the root-sum-square S tolerance is taken off Smax, as
 * PCB Libraries' calculator does ([PCBL-2025] slide 18); its published outputs ([PCBL-2025]
 * slide 15, [PCBL-30]) come out of these equations.
 */
export function landPattern(lead: Lead, goals: FilletGoals, tol: Tolerances): LandPattern {
  const cl = lead.span.max - lead.span.min
  const ct = lead.terminal.max - lead.terminal.min
  const cw = lead.width.max - lead.width.min
  const sMin = lead.span.min - 2 * lead.terminal.max
  const sMax = lead.span.max - 2 * lead.terminal.min
  const csRms = Math.sqrt(cl ** 2 + 2 * ct ** 2)
  const sMaxRms = sMax - (sMax - sMin - csRms) / 2
  const withProcess = (c: number) => Math.sqrt(c ** 2 + tol.fabrication ** 2 + tol.placement ** 2)
  return {
    Z: lead.span.min + 2 * goals.toe + withProcess(cl),
    G: sMaxRms - 2 * goals.heel - withProcess(csRms),
    X: lead.width.min + 2 * goals.side + withProcess(cw),
  }
}

/**
 * F, the board fabrication tolerance, and P, the placement tolerance. [IPC-7351] §3.1.4, p. 10:
 * "F is 0.1 mm (assumed fabrication tolerance). P is 0.05 mm (assumed assembly equipment placement
 * tolerance)." PCB Libraries writes the same tolerances as ±0.05 and ±0.025 ([PCBL-2025] slides 15
 * and 19), and its IPC-7351B outputs ([PCBL-2025] slide 15, [PCBL-30]) only come out with
 * F = 0.10 and P = 0.05 in the equations.
 */
export const IPC_TOLERANCES: Readonly<Tolerances> = Object.freeze({ fabrication: 0.1, placement: 0.05 })

/**
 * Rectangular or square-end components equal to or larger than 1608 (0603), density level B
 * (nominal): [IPC-7351B] Table 3-5, p. 17, reproduced in [PCBL-2588] and [PCBL-2025] slide 13.
 */
export const CHIP_GOALS: Readonly<FilletGoals> = Object.freeze({ toe: 0.35, heel: 0, side: 0 })

/** The same, smaller than 1608 (0603): [IPC-7351B] Table 3-6, p. 17, reproduced in [PCBL-2588]. */
export const SMALL_CHIP_GOALS: Readonly<FilletGoals> = Object.freeze({ toe: 0.2, heel: 0, side: 0 })

/** Table 3-6 applies to chips "smaller than 1608 (0603)", that is shorter than 1.6 mm. */
const SMALL_CHIP_LENGTH = 1.6

/**
 * Flat ribbon L and gull-wing leads, pitch greater than 0.625 mm (two-terminal SOD packages have no
 * pitch), density level B: [IPC-7351B] Table 3-2, p. 16, reproduced in [PCBL-2587] and [PCBL-1744].
 * The table lists SOD under it ("Small Outline Diode SOD ... described in 8.8").
 */
export const GULL_WING_GOALS: Readonly<FilletGoals> = Object.freeze({ toe: 0.35, heel: 0.35, side: 0.03 })

/**
 * [IPC-7351B] Table 3-2, Note 1: "For gull wing components where dimension Smin is less than or equal
 * to dimension Amax, use the following heel fillet goals: ... Density Level B - 0.15 mm".
 * Note 2: "This does not apply to gull wing components where the lead terminals have a tolerance T1
 * that is greater than 0.5 mm."
 */
const NOTE_1_HEEL = 0.15
const NOTE_2_TERMINAL_TOLERANCE = 0.5

/**
 * Courtyard excess at density level B: 0.25 in [IPC-7351B] Table 3-2 (p. 16) and Table 3-5
 * ([PCBL-2025] slide 13). Table 3-6 allows 0.15 for chips smaller than 0603; the engine plan uses
 * 0.25 for every family, which leaves more room.
 */
export const COURTYARD_EXCESS = 0.25

export function chipGoals(bodyLength: Range): FilletGoals {
  const nominal = (bodyLength.min + bodyLength.max) / 2
  return nominal < SMALL_CHIP_LENGTH - 1e-9 ? SMALL_CHIP_GOALS : CHIP_GOALS
}

/**
 * Gull-wing goals with Note 1 applied. Amax is taken as the body length between the lead exits, as
 * PCB Libraries draws it ([PCBL-1744], "Mini_Gull-Wing_Formula"); for the SOD packages here Smin is
 * also below the toe-to-toe span, so the other reading in that thread gives the same goals.
 */
export function gullWingGoals(lead: Lead, bodyLength: Range): FilletGoals {
  const sMin = lead.span.min - 2 * lead.terminal.max
  const terminalTolerance = lead.terminal.max - lead.terminal.min
  const note1 = sMin <= bodyLength.max + 1e-9 && terminalTolerance <= NOTE_2_TERMINAL_TOLERANCE + 1e-9
  return note1 ? { ...GULL_WING_GOALS, heel: NOTE_1_HEEL } : GULL_WING_GOALS
}

/**
 * Engine plan: Z and X are rounded up and G down to 0.01 mm. IPC-7351B's round-off factors are
 * coarser (0.05 mm in Tables 3-2 and 3-5, 0.02 mm in Table 3-6); PCB Libraries' calculator also
 * works to 0.01 mm ([PCBL-2025] slide 15).
 */
const STEPS_PER_MM = 100
const FLOAT_SLACK = 1e-6

/** Engine plan: round rectangles with a corner radius of 25% of the shorter side, at most 0.25 mm. */
const CORNER_RATIO = 0.25
const MAX_CORNER_RADIUS = 0.25

/**
 * The two pads of a two-terminal land pattern: (Z − G)/2 wide and X high, centred at
 * x = ±(Z + G)/4, pad 1 at negative x. Throws when the rounded pattern leaves no gap, which means the
 * package table is wrong.
 */
export function twoTerminalPads(pattern: LandPattern): Pad[] {
  const z = Math.ceil(pattern.Z * STEPS_PER_MM - FLOAT_SLACK)
  const g = Math.floor(pattern.G * STEPS_PER_MM + FLOAT_SLACK)
  const x = Math.ceil(pattern.X * STEPS_PER_MM - FLOAT_SLACK)
  if (g <= 0 || z <= g) throw new Error(`land pattern has no gap between its pads (Z ${pattern.Z}, G ${pattern.G})`)
  const width = (z - g) / (2 * STEPS_PER_MM)
  const centre = (z + g) / (4 * STEPS_PER_MM)
  const height = x / STEPS_PER_MM
  return [roundRectPad("1", -centre, width, height), roundRectPad("2", centre, width, height)]
}

function roundRectPad(number: string, x: number, width: number, height: number): Pad {
  return {
    number,
    shape: "roundrect",
    x,
    y: 0,
    width,
    height,
    rotation: 0,
    layers: "top",
    cornerRadius: Math.min(MAX_CORNER_RADIUS, CORNER_RATIO * Math.min(width, height)),
  }
}
