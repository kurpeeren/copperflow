/**
 * IPC-7351B nominal (density level B) land patterns: the equations, the solder joint goal tables, the
 * round-off and the rows of pads that come out of them. Lengths are in mm. Every constant names
 * its source. The IPC-7351B tables were read from page images that PCB Libraries reproduces; its
 * running text (equations, tolerances, rounding) was not seen, so those come from the 2005 edition
 * and from PCB Libraries' published calculator outputs, as noted at each place.
 *
 * Sources cited below:
 * - [IPC-7351B] IPC-7351B, "Generic Requirements for Surface Mount Design and Land Pattern Standard",
 *   June 2010. Table numbers and pages as listed in its table of contents
 *   (https://www.ipc.org/TOC/IPC-7351B.pdf, now served from https://www.electronics.org/TOC/IPC-7351B.pdf).
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
 * - [PCBL-785] PCB Libraries Forum, "IPC-7351 SMD & PTH Reference Calculators", post by Jeff.M,
 *   25 Feb 2021, https://www.pcblibraries.com/forum/printer_friendly_posts.asp?TID=785
 * - [FOOTAG2] endofexclusive/footag2, src/ipc7351b/table.c, a transcription of the IPC-7351B goal
 *   tables, https://github.com/endofexclusive/footag2/blob/master/src/ipc7351b/table.c (values cited,
 *   no code taken). Its Tables 3-2, 3-5 and 3-6 and the goal rows of its Table 3-3 agree with the
 *   page images that PCB Libraries reproduces.
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

/** One IPC-7351B solder joint goal table at density level B. */
export interface GoalTable {
  goals: FilletGoals
  /** The table's round-off step: Z, G and X go to the nearest multiple, the courtyard up to one. */
  roundOff: number
  /** Added on every side of the larger of the pads and the component. */
  courtyardExcess: number
}

/**
 * The land pattern equations as [IPC-7351] §3.1.5 (p. 10) gives them; the IPC-7351B wording was not
 * seen:
 *   Z = Lmin + 2·Jt + √(CL² + F² + P²)
 *   G = Smax' − 2·Jh − √(CSrms² + F² + P²)
 *   X = Wmin + 2·Js + √(CW² + F² + P²)
 * with Smin = Lmin − 2·Tmax, Smax = Lmax − 2·Tmin and CSrms = √(CL² + 2·CT²). Smax' takes half of
 * the difference between the worst-case and the root-sum-square S tolerance off Smax, as PCB
 * Libraries' calculator does ([PCBL-2025] slide 18); its published outputs ([PCBL-2025] slide 15,
 * [PCBL-30]) come out of these equations. [IPC-7351] §3.1.1 (p. 9) instead adds CSrms to Smin,
 * which gives a smaller G; [PCBL-785] quotes the SOIC example of [IPC-7351B] §3.1.1 (L 5.8–6.2,
 * T 0.4–1.27, Smin 3.26, Smax 5.40) and says IPC-7351B takes the Smax' form.
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
 * F, the board fabrication tolerance (0.10 mm), and P, the placement tolerance (0.05 mm), as assumed
 * values in [IPC-7351] §3.1.4, p. 10; the IPC-7351B wording was not seen. PCB Libraries writes the
 * same tolerances as ±0.05 and ±0.025 ([PCBL-2025] slides 15 and 19), and its published outputs
 * ([PCBL-2025] slide 15, [PCBL-30]) only come out with F = 0.10 and P = 0.05 in the equations.
 */
export const IPC_TOLERANCES: Readonly<Tolerances> = Object.freeze({ fabrication: 0.1, placement: 0.05 })

function table(goals: FilletGoals, roundOff: number, courtyardExcess: number): Readonly<GoalTable> {
  return Object.freeze({ goals: Object.freeze(goals), roundOff, courtyardExcess })
}

/**
 * Rectangular or square-end components equal to or larger than 1608 (0603), level B:
 * [IPC-7351B] Table 3-5, p. 17, reproduced in [PCBL-2588] and [PCBL-2025] slide 13. Toe 0.35,
 * heel 0, side 0; round-off to the nearest 0.05 mm; courtyard excess 0.25.
 */
export const CHIP_TABLE = table({ toe: 0.35, heel: 0, side: 0 }, 0.05, 0.25)

/**
 * The same, smaller than 1608 (0603): [IPC-7351B] Table 3-6, p. 17, reproduced in [PCBL-2588] and
 * [PCBL-2025] slide 13. Toe 0.20, heel 0, side 0; round-off to the nearest 0.02 mm; courtyard
 * excess 0.15.
 */
export const SMALL_CHIP_TABLE = table({ toe: 0.2, heel: 0, side: 0 }, 0.02, 0.15)

/** Table 3-6 applies to chips smaller than 1608 (0603), that is shorter than 1.6 mm. */
const SMALL_CHIP_LENGTH = 1.6

/**
 * Flat ribbon L and gull-wing leads with a pitch over 0.625 mm (two-terminal SOD packages have no
 * pitch), level B: [IPC-7351B] Table 3-2, p. 16, reproduced in [PCBL-2587] and [PCBL-1744]; the table
 * names small outline diodes (section 8.8) among its families. Toe 0.35, heel 0.35, side 0.03;
 * round-off to the nearest 0.05 mm; courtyard excess 0.25.
 */
export const GULL_WING_TABLE = table({ toe: 0.35, heel: 0.35, side: 0.03 }, 0.05, 0.25)

/**
 * The same leads with a pitch of 0.625 mm or less, level B: [IPC-7351B] Table 3-3, p. 16. Toe 0.35,
 * heel 0.35, side −0.02, as in the page image reproduced in [PCBL-2587]. That image stops after the
 * side row; the round-off (nearest 0.05 mm) and courtyard excess (0.25) come from [FOOTAG2] and are
 * the same as Table 3-2's.
 */
export const FINE_PITCH_GULL_WING_TABLE = table({ toe: 0.35, heel: 0.35, side: -0.02 }, 0.05, 0.25)

/** The titles of [IPC-7351B] Tables 3-2 and 3-3 split gull-wing leads at a pitch of 0.625 mm. */
const FINE_PITCH = 0.625

/** Table 3-2 for a pitch over 0.625 mm, Table 3-3 for 0.625 mm and under. */
export function gullWingTable(pitch: number): Readonly<GoalTable> {
  return pitch > FINE_PITCH + 1e-9 ? GULL_WING_TABLE : FINE_PITCH_GULL_WING_TABLE
}

/**
 * Quad flat no-lead packages, level B: [IPC-7351B] Table 3-15 "Quad Flat No-Lead", p. 19 (title and
 * page from the table of contents). Toe 0.30, heel 0, side −0.04; round-off to the nearest 0.05 mm;
 * courtyard excess 0.25, as transcribed in [FOOTAG2]. No page image of this table was found, so
 * [FOOTAG2] is the only source for these values.
 */
export const QFN_TABLE = table({ toe: 0.3, heel: 0, side: -0.04 }, 0.05, 0.25)

/**
 * [IPC-7351B] Table 3-2, Note 1 (paraphrased): when Smin is at most Amax, the level B heel goal is
 * 0.15 mm. Note 2: Note 1 does not apply when the terminal length tolerance exceeds 0.5 mm. The note
 * text was seen under Table 3-2 ([PCBL-1744], image Untitled3.png); the heel row of Table 3-3 carries
 * the same note mark ([PCBL-2587]).
 */
const NOTE_1_HEEL = 0.15
const NOTE_2_TERMINAL_TOLERANCE = 0.5

export function chipTable(bodyLength: Range): Readonly<GoalTable> {
  const nominal = (bodyLength.min + bodyLength.max) / 2
  return nominal < SMALL_CHIP_LENGTH - 1e-9 ? SMALL_CHIP_TABLE : CHIP_TABLE
}

/**
 * The goals of a gull-wing table (Table 3-2 by default, or Table 3-3) with Note 1 applied.
 *
 * `aMax` is the largest size of the package body measured between the two rows of leads, along the
 * leads: E1 of a SOIC or TSSOP, E of a SOT-23, the body of a QFP, the body length of a SOD. Note 1
 * then gives the shorter heel to feet that reach back under the body.
 *
 * How the reading was settled. In [PCBL-1744], Tom H posted on 6 Feb 2025 (3:59 pm) the lead-style
 * drawing PCB Libraries made when it helped IPC define the two lead forms (Mini_Gull-Wing_Formula.JPG).
 * It states both cases in the form of Notes 1 and 2 (mini gull-wing when Smin ≤ Amax and the
 * terminal tolerance is under 0.5 mm, standard gull-wing otherwise) and draws A across the body and
 * S between the inner ends of the feet. Posts in the same thread (5 Aug 2015; 6 Feb 2025, 9:23 am)
 * call Amax the lead span, toe to toe; but Smin = Lmin − 2·Tmax is always below the lead span, so that
 * reading would apply Note 1 to every gull-wing part and leave its condition without effect. No
 * independent IPC-7351B nominal pattern was found for a package where the two readings differ
 * (TSSOP, SOP and QFP do; SOT-23 and SOIC-8 do not), so this is a sourced reading, not one checked
 * against such a pattern.
 */
export function gullWingGoals(lead: Lead, aMax: number, goalTable: Readonly<GoalTable> = GULL_WING_TABLE): FilletGoals {
  const sMin = lead.span.min - 2 * lead.terminal.max
  const terminalTolerance = lead.terminal.max - lead.terminal.min
  const note1 = sMin <= aMax + 1e-9 && terminalTolerance <= NOTE_2_TERMINAL_TOLERANCE + 1e-9
  return note1 ? { ...goalTable.goals, heel: NOTE_1_HEEL } : { ...goalTable.goals }
}

/** Absorbs floating-point noise when a value lands on a step boundary. */
const FLOAT_SLACK = 1e-6

/**
 * `value` rounded to a multiple of `step` (a step that divides 1 mm), returned as a whole number of
 * steps. Which way: see `GoalTable.roundOff` and the callers.
 */
function steps(value: number, step: number, mode: "nearest" | "up"): number {
  const count = value / step
  return mode === "up" ? Math.ceil(count - FLOAT_SLACK) : Math.round(count + FLOAT_SLACK)
}

/** `value` rounded up to a multiple of `step`, without floating-point noise. */
export function roundUpToStep(value: number, step: number): number {
  return steps(value, step, "up") / Math.round(1 / step)
}

/** Engine plan: round rectangles with a corner radius of 25% of the shorter side, at most 0.25 mm. */
const CORNER_RATIO = 0.25
const MAX_CORNER_RADIUS = 0.25

/** One row of identical pads, as a land pattern gives it. */
export interface PadRow {
  /** (Z − G)/2, along the lead. */
  length: number
  /** X, across the lead. */
  width: number
  /** (Z + G)/4, from the part centre to the pad centre. */
  centre: number
}

/**
 * The pads of a land pattern after rounding Z, G and X to the nearest multiple of the table's
 * round-off step, as the round-off rows of [IPC-7351B] Tables 3-2, 3-3, 3-5, 3-6 and 3-15 put it
 * ([IPC-7351] §3.1.5.1, p. 11, likewise lets the round-off go up or down). Throws when the rounded
 * pattern leaves no gap, which means the package table is wrong.
 */
export function padRow(pattern: LandPattern, roundOff: number): PadRow {
  const perMm = Math.round(1 / roundOff)
  const z = steps(pattern.Z, roundOff, "nearest")
  const g = steps(pattern.G, roundOff, "nearest")
  const x = steps(pattern.X, roundOff, "nearest")
  if (g <= 0 || z <= g) throw new Error(`land pattern has no gap between its pads (Z ${pattern.Z}, G ${pattern.G})`)
  return { length: (z - g) / (2 * perMm), width: x / perMm, centre: (z + g) / (4 * perMm) }
}

/** The two pads of a two-terminal land pattern, along x, pad 1 at negative x. */
export function twoTerminalPads(pattern: LandPattern, roundOff: number): Pad[] {
  const row = padRow(pattern, roundOff)
  return [roundRectPad("1", -row.centre, 0, row.length, row.width), roundRectPad("2", row.centre, 0, row.length, row.width)]
}

/** A top-side round-rectangle pad, `width` along x and `height` along y. */
export function roundRectPad(number: string, x: number, y: number, width: number, height: number): Pad {
  return {
    number,
    shape: "roundrect",
    x,
    y,
    width,
    height,
    rotation: 0,
    layers: "top",
    cornerRadius: Math.min(MAX_CORNER_RADIUS, CORNER_RATIO * Math.min(width, height)),
  }
}
