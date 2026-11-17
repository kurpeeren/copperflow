/**
 * Impedance of surface lines on the outer layer, from closed-form equations. Pure functions; lengths in mm.
 *
 * Single line: E. Hammerstad and O. Jensen, "Accurate Models for Microstrip Computer-Aided Design", IEEE MTT-S
 * International Microwave Symposium Digest, 1980, pp. 407-409: the static impedance and effective permittivity, with
 * their correction for the strip's thickness. Stated accuracy better than 0.2 % (zero thickness) for
 * 0.01 <= w/h <= 100 and 1 <= er <= 128; the thickness correction holds for t much less than h and t < w/2.
 *
 * Pair: the edge-coupled factor of IPC-2141A (2004), "Design Guide for High-Speed Controlled Impedance Circuit
 * Boards", Zdiff = 2 Z0 (1 - 0.48 exp(-0.96 s/h)), applied to the Hammerstad and Jensen Z0. IPC gives it for
 * 0.1 < w/h < 2 and 0.2 < s/h < 3 (roughly); expect about +-10 % there.
 *
 * Neither counts solder mask, which lowers a surface line's impedance by a few ohm, nor frequency.
 * These are estimates: for a controlled impedance order, ask the board maker for their stack and widths.
 */

export interface Stack {
  /** Dielectric height between the line and the plane under it. */
  height: number
  permittivity: number
  /** Copper thickness. */
  thickness: number
}

export interface Line extends Stack {
  width: number
}

export interface Result {
  impedance: number
  effectivePermittivity: number
  /** Set when the figures are outside the equations' range: the answer is then a rough guess. */
  warning?: string
}

const ETA0 = 376.73
const SINGLE_RANGE = { minU: 0.01, maxU: 100, maxEr: 128 }
const PAIR_RANGE = { minU: 0.1, maxU: 2, minS: 0.2, maxS: 3 }

/** The impedance of a strip in air, Hammerstad and Jensen eq. for Z01(u). */
function airImpedance(u: number): number {
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528))
  return (ETA0 / (2 * Math.PI)) * Math.log(f / u + Math.sqrt(1 + 4 / (u * u)))
}

/** Effective permittivity at zero thickness, Hammerstad and Jensen eq. with a(u) and b(er). */
function effective(u: number, er: number): number {
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7
  const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053)
  return (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 10 / u, -a * b)
}

const coth = (x: number) => 1 / Math.tanh(x)

/** Surface microstrip: Hammerstad and Jensen, with their thickness correction (widths u1 for air, ur for the dielectric). */
export function microstrip(line: Line): Result {
  const { width, height, permittivity: er, thickness: t } = line
  const u = width / height
  let u1 = u
  let ur = u
  if (t > 0) {
    const tn = t / height
    const du1 = (tn / Math.PI) * Math.log(1 + (4 * Math.E) / (tn * coth(Math.sqrt(6.517 * u)) ** 2))
    u1 = u + du1
    ur = u + 0.5 * (1 + 1 / Math.cosh(Math.sqrt(er - 1))) * du1
  }
  const eReff = effective(ur, er) * (airImpedance(u1) / airImpedance(ur)) ** 2
  const impedance = airImpedance(ur) / Math.sqrt(effective(ur, er))
  const outside = u < SINGLE_RANGE.minU || u > SINGLE_RANGE.maxU || er < 1 || er > SINGLE_RANGE.maxEr || t >= height || t >= width / 2
  const warning = outside ? `w/h ${round(u)} or er ${round(er)} is outside the single-line equations' range (0.01 to 100, er 1 to 128, t < w/2): a rough guess` : undefined
  return { impedance, effectivePermittivity: eReff, ...(warning ? { warning } : {}) }
}

/** Edge-coupled surface pair: IPC-2141A coupling on the single line's impedance. */
export function microstripPair(line: Line & { gap: number }): Result {
  const single = microstrip(line)
  const s = line.gap / line.height
  const u = line.width / line.height
  const impedance = 2 * single.impedance * (1 - 0.48 * Math.exp(-0.96 * s))
  const outside = u < PAIR_RANGE.minU || u > PAIR_RANGE.maxU || s < PAIR_RANGE.minS || s > PAIR_RANGE.maxS
  const warning = single.warning ?? (outside ? `w/h ${round(u)} or s/h ${round(s)} is outside the pair equation's range (w/h 0.1 to 2, s/h 0.2 to 3): expect more than 10 % error` : undefined)
  return { impedance, effectivePermittivity: single.effectivePermittivity, ...(warning ? { warning } : {}) }
}

const round = (n: number) => String(Math.round(n * 1000) / 1000)

/** Bisection on a falling function: the x in [lo, hi] where f(x) = target, or undefined when none. */
function solveFalling(f: (x: number) => number, target: number, lo: number, hi: number): number | undefined {
  if (f(lo) < target || f(hi) > target) return undefined
  let [a, b] = [lo, hi]
  for (let i = 0; i < 80; i += 1) {
    const m = Math.sqrt(a * b)
    if (f(m) > target) a = m
    else b = m
  }
  return Math.sqrt(a * b)
}

const WIDEST = 100

/** The width that gives `impedance` for a single line; NaN when none in the equations' range. */
export function widthFor(impedance: number, stack: Stack): { width: number; warning?: string } {
  const width = solveFalling((w) => microstrip({ ...stack, width: w }).impedance, impedance, stack.height * 0.01, stack.height * WIDEST)
  if (width === undefined) return { width: Number.NaN, warning: `${impedance} ohm is out of reach on this stack` }
  const warning = microstrip({ ...stack, width }).warning
  return warning ? { width, warning } : { width }
}

/** The width that gives `impedance` for a pair at `gap`; NaN when none. */
export function pairWidthFor(impedance: number, gap: number, stack: Stack): { width: number; warning?: string } {
  const width = solveFalling((w) => microstripPair({ ...stack, width: w, gap }).impedance, impedance, stack.height * 0.01, stack.height * WIDEST)
  if (width === undefined) return { width: Number.NaN, warning: `${impedance} ohm differential is out of reach at a ${gap} mm gap` }
  const warning = microstripPair({ ...stack, width, gap }).warning
  return warning ? { width, warning } : { width }
}

/** The gap that gives `impedance` for a pair of `width`; undefined when none (the pair rises with the gap). */
export function pairGapFor(impedance: number, width: number, stack: Stack): { gap?: number; warning?: string } {
  const f = (g: number) => -microstripPair({ ...stack, width, gap: g }).impedance
  const gap = solveFalling(f, -impedance, stack.height * 0.001, stack.height * 10)
  if (gap === undefined) return { warning: `${impedance} ohm differential is out of reach at a ${width} mm width` }
  const warning = microstripPair({ ...stack, width, gap }).warning
  return warning ? { gap, warning } : { gap }
}

export interface PairPlan {
  practical: boolean
  width: number
  gap: number
  /** One sentence for a person. */
  text: string
  warning?: string
}

const mm2 = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * The width and gap of a pair for `impedance`: at the given gap (solving the width), or at the given width (solving
 * the gap). Not practical when the gap or width falls under the profile's smallest; the text then says so.
 */
export function pairPlan(
  impedance: number,
  stack: Stack & { boardThickness: number },
  limits: { minGap: number; minWidth: number },
  gap?: number,
  width?: number,
): PairPlan {
  const board = `on a ${mm2(stack.boardThickness)} mm board`
  const unpractical = (w: number, g: number, what: "gap" | "width"): PairPlan => ({
    practical: false,
    width: w,
    gap: g,
    text: `${impedance} ohm differential needs a ${mm2(g)} mm gap at ${mm2(w)} mm width ${board}, under the profile's smallest ${what}: use a thinner board or accept the mismatch on a short run`,
  })
  if (width !== undefined) {
    const found = pairGapFor(impedance, width, stack)
    const g = found.gap ?? stack.height * 0.001
    if (g < limits.minGap) return unpractical(width, g, "gap")
    return practical(impedance, width, g, board, found.warning)
  }
  const g = gap ?? 2 * limits.minGap
  const found = pairWidthFor(impedance, g, stack)
  const w = Number.isNaN(found.width) ? stack.height * 0.01 : found.width
  if (w < limits.minWidth) return unpractical(w, g, "width")
  return practical(impedance, w, g, board, found.warning)
}

function practical(impedance: number, width: number, gap: number, board: string, warning?: string): PairPlan {
  const text = `${impedance} ohm differential: ${mm2(width)} mm width at a ${mm2(gap)} mm gap ${board}`
  return { practical: true, width, gap, text, ...(warning ? { warning } : {}) }
}

/** The error band said with every figure. */
export const ESTIMATE_NOTE =
  "Estimates: single line Hammerstad and Jensen (1980), within about 1 % for w/h 0.01 to 100; pair IPC-2141A coupling, about 10 % for w/h 0.1 to 2 and s/h 0.2 to 3; solder mask and frequency not counted. For a controlled impedance order, ask the board maker for their stack and widths."
