// The device equations of the DC solver and how each is fitted to datasheet figures. The method is the textbook's:
// F. N. Najm, "Circuit Simulation", Wiley 2010 (ch. 2 for nodal analysis, ch. 3 for Newton's method and the limiting
// of junction voltage steps). Every model is a static curve i = f(v) with its slope, evaluated at 300 K.

/** The thermal voltage kT/q at 300 K (27 °C), in volts. */
export const VT = 0.025852

/** Above this exponent a junction's exponential is continued as a straight line, so nothing overflows. */
const EXP_LIMIT = 60

/** e^x and its slope, continued linearly above EXP_LIMIT. */
function expLimited(x: number): { value: number; slope: number } {
  if (x <= EXP_LIMIT) {
    const value = Math.exp(x)
    return { value, slope: value }
  }
  const top = Math.exp(EXP_LIMIT)
  return { value: top * (1 + x - EXP_LIMIT), slope: top }
}

/** A diode's breakdown: `iz` flows at a reverse voltage of `vz`, rising e-fold every `nvt` volts beyond it. */
export interface Breakdown {
  vz: number
  iz: number
  nvt: number
}

/** A junction diode: Shockley's equation i = is (e^(v / (n VT)) - 1) behind a series resistance `rs`. */
export interface DiodeModel {
  is: number
  n: number
  rs: number
  breakdown?: Breakdown
}

export interface Curve {
  i: number
  g: number
}

/** The junction's current and slope at the junction voltage `v` (anode minus cathode, without `rs`). */
export function diodeCurve(model: DiodeModel, v: number): Curve {
  const nvt = model.n * VT
  const forward = expLimited(v / nvt)
  let i = model.is * (forward.value - 1)
  let g = (model.is * forward.slope) / nvt
  const b = model.breakdown
  if (b) {
    // Zero at 0 V and exactly iz at -vz: the offset e^(-vz / nvt) is taken out and the rest scaled back.
    const floor = Math.exp(-b.vz / b.nvt)
    const reverse = expLimited((-v - b.vz) / b.nvt)
    const scale = b.iz / (1 - floor)
    i -= scale * (reverse.value - floor)
    g += (scale * reverse.slope) / b.nvt
  }
  return { i, g: g + 1e-15 }
}

/**
 * The emission coefficient n and saturation current is from one point (vf at if, n given) or two (n from their
 * slope). The series resistance rs, when given, is taken off each point first: the fitted curve meets every point.
 */
export function fitDiode(figures: { vf: number; vfAt: number; vf2?: number; vf2At?: number; rs?: number; n: number }): { is: number; n: number; rs: number } {
  const rs = figures.rs ?? 0
  const v1 = figures.vf - figures.vfAt * rs
  let n = figures.n
  if (figures.vf2 !== undefined && figures.vf2At !== undefined) {
    const v2 = figures.vf2 - figures.vf2At * rs
    n = (v2 - v1) / (VT * Math.log(figures.vf2At / figures.vfAt))
  }
  if (!(n > 0) || !Number.isFinite(n)) throw new Error("the two forward points do not rise together; check vf, vfAt, vf2 and vf2At")
  const is = figures.vfAt / Math.expm1(v1 / (n * VT))
  return { is, n, rs }
}

/** A MOSFET's square law, fitted so that the on-resistance at the datasheet's gate voltage is the datasheet's. */
export interface MosModel {
  /** The threshold, as a positive voltage for either channel. */
  vth: number
  /** The square law's factor k in A/V²: id = k ((vgs - vth) vds - vds² / 2) below saturation. */
  k: number
  /** The gate voltage at which the datasheet gives its on-resistance: at or above it the switch is fully on. */
  vgsOn: number
  body: DiodeModel
}

/** k from rds(on) at vgs: in the linear region near vds = 0 the channel's resistance is 1 / (k (vgs - vth)). */
export function fitMos(figures: { vth: number; rdson: number; rdsonAt: number }): number {
  const overdrive = figures.rdsonAt - figures.vth
  if (!(overdrive > 0)) throw new Error(`rdsonAt (${figures.rdsonAt} V) must be above vth (${figures.vth} V)`)
  return 1 / (figures.rdson * overdrive)
}

export interface MosPoint {
  id: number
  /** d id / d vgs and d id / d vds. */
  gm: number
  gds: number
  region: "off" | "linear" | "saturation"
}

/** The drain current of an N channel (positive voltages) at vgs and vds >= 0. */
export function mosCurve(model: MosModel, vgs: number, vds: number): MosPoint {
  const over = vgs - model.vth
  if (over <= 0) return { id: 0, gm: 0, gds: 0, region: "off" }
  if (vds < over) return { id: model.k * (over * vds - (vds * vds) / 2), gm: model.k * vds, gds: model.k * (over - vds), region: "linear" }
  return { id: (model.k / 2) * over * over, gm: model.k * over, gds: 0, region: "saturation" }
}

/** A bipolar transistor in the Ebers-Moll transport form, with saturation current is and gains bf and br. */
export interface BjtModel {
  is: number
  bf: number
  br: number
}

export interface BjtPoint {
  ic: number
  ib: number
  /** Partial derivatives of ic and ib by vbe and vbc. */
  dic: { be: number; bc: number }
  dib: { be: number; bc: number }
}

/** NPN currents into the collector and the base at vbe and vbc. */
export function bjtCurve(model: BjtModel, vbe: number, vbc: number): BjtPoint {
  const fe = expLimited(vbe / VT)
  const fc = expLimited(vbc / VT)
  const transport = model.is * (fe.value - fc.value)
  const ibe = (model.is / model.bf) * (fe.value - 1)
  const ibc = (model.is / model.br) * (fc.value - 1)
  const gbe = (model.is * fe.slope) / VT
  const gbc = (model.is * fc.slope) / VT
  return {
    ic: transport - ibc,
    ib: ibe + ibc,
    dic: { be: gbe, bc: -gbc - gbc / model.br },
    dib: { be: gbe / model.bf, bc: gbc / model.br },
  }
}

/** The forced gain at which a datasheet usually states vce(sat): ic / ib = 10. */
export const FORCED_GAIN = 10

/** vce(sat) of the transport model at the forced gain: VT ln((1 / alphaR + forced / br) / (1 - forced / bf)). */
export function vceSat(bf: number, br: number, forced = FORCED_GAIN): number {
  const alphaR = br / (1 + br)
  return VT * Math.log((1 / alphaR + forced / br) / (1 - forced / bf))
}

/**
 * is from vbe at ic (the transport current, n = 1), bf = hfe, and br found by bisection so that vce(sat) at the
 * forced gain is the datasheet's; without vcesat, br = 1.
 */
export function fitBjt(figures: { hfe: number; vbe: number; vbeAt: number; vcesat?: number }): BjtModel {
  if (!(figures.hfe > FORCED_GAIN)) throw new Error(`hfe must be above ${FORCED_GAIN}`)
  const is = figures.vbeAt / Math.exp(figures.vbe / VT)
  if (figures.vcesat === undefined) return { is, bf: figures.hfe, br: 1 }
  // vce(sat) falls as br rises; search br on a log scale between 0.01 and 1000.
  let low = Math.log(0.01)
  let high = Math.log(1000)
  const at = (logBr: number) => vceSat(figures.hfe, Math.exp(logBr))
  if (figures.vcesat >= at(low)) return { is, bf: figures.hfe, br: 0.01 }
  if (figures.vcesat <= at(high)) return { is, bf: figures.hfe, br: 1000 }
  for (let step = 0; step < 80; step++) {
    const mid = (low + high) / 2
    if (at(mid) > figures.vcesat) low = mid
    else high = mid
  }
  return { is, bf: figures.hfe, br: Math.exp((low + high) / 2) }
}

/** The junction voltage beyond which a step is limited: n VT ln(n VT / (√2 is)). */
export function criticalVoltage(model: { is: number; n: number }): number {
  const nvt = model.n * VT
  return nvt * Math.log(nvt / (Math.SQRT2 * model.is))
}

/**
 * The step of a junction voltage from `previous` to `next` with large forward steps taken on a logarithm, as the
 * textbook's limiting does, so Newton's method does not overshoot an exponential.
 */
export function limitJunction(next: number, previous: number, nvt: number, critical: number): number {
  if (next <= critical || Math.abs(next - previous) <= 2 * nvt) return next
  if (previous > 0) {
    const arg = 1 + (next - previous) / nvt
    return arg > 0 ? previous + nvt * Math.log(arg) : critical
  }
  return nvt * Math.log(next / nvt)
}

/** The largest change of a MOSFET's gate voltage in one Newton step. */
export const GATE_STEP = 1
