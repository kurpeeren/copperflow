import { crowded, exposedPadSize, mm, onlyPitch, sizeText } from "./exposed.js"
import { confirmsPackage, gullWingRow, leadlessRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type PadRow, type Range } from "./ipc7351.js"
import { qfnPackage, qfpPackage } from "./jedec.js"
import { bodyOutline, centredOffsets, courtyard, quadSilkscreen, tidy, type Extent } from "./outline.js"
import { isSimple, type Pair, type ParsedFootprint } from "./parse.js"
import { isRefusal, refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/** A square quad package. `exposedPad` is the thermal pad's side (Dh = Eh), for no-lead packages. */
interface QuadPackage extends IcPackage {
  exposedPad?: Range
}

/**
 * NXP Semiconductors package information (JEDEC MS-026), dimension table of the package outline, the
 * body square (D = E, HD = HE):
 * - LQFP32 SOT358-1, 19 July 2017: HD 8.85–9.15, Lp 0.45–0.75, bp 0.30–0.40, D 6.9–7.1, e 0.8
 * - LQFP48 SOT313-2, 8 February 2016: HD 8.85–9.15, Lp 0.45–0.75, bp 0.17–0.27, D 6.9–7.1, e 0.5
 * - LQFP64 SOT314-2, 8 February 2016: HD 11.85–12.15, Lp 0.45–0.75, bp 0.17–0.27, D 9.9–10.1, e 0.5
 * - LQFP100 SOT407-1, 1 February 2019: HD 15.75–16.25, Lp 0.45–0.75, bp 0.17–0.27, D 13.9–14.1, e 0.5
 * https://www.nxp.com/docs/en/package-information/SOT313-2.pdf (and SOT358-1, SOT314-2, SOT407-1)
 */
const lqfp = (pins: number, pitch: number, span: Range, leadWidth: Range, body: Range): QuadPackage => ({
  label: `LQFP-${pins}`,
  pitch,
  span,
  terminal: range(0.45, 0.75),
  leadWidth,
  bodyAcross: body,
  bodyAlong: body,
})

const QFPS = new Map<string, QuadPackage>([
  ["32", lqfp(32, 0.8, range(8.85, 9.15), range(0.3, 0.4), range(6.9, 7.1))],
  ["48", lqfp(48, 0.5, range(8.85, 9.15), range(0.17, 0.27), range(6.9, 7.1))],
  ["64", lqfp(64, 0.5, range(11.85, 12.15), range(0.17, 0.27), range(9.9, 10.1))],
  ["100", lqfp(100, 0.5, range(15.75, 16.25), range(0.17, 0.27), range(13.9, 14.1))],
])

/**
 * NXP Semiconductors package information (JEDEC MO-220), dimension table of the package outline, the
 * body square: L 0.3–0.5, b 0.18–0.30, e 0.5, and
 * - HVQFN16 SOT758-1, 29 September 2025: D 2.9–3.1, Dh 1.45–1.75
 * - HVQFN32 SOT617-1, 12 July 2021: D 4.9–5.1, Dh 2.95–3.25
 * - HVQFN48 SOT619-1, 5 February 2018: D 6.9–7.1, Dh 4.95–5.25
 * The terminals end at the body edge, so the body is also the span.
 * https://www.nxp.com/docs/en/package-information/SOT617-1.pdf (and SOT758-1, SOT619-1)
 */
const hvqfn = (pins: number, body: Range, exposedPad: Range): QuadPackage => ({
  label: `QFN-${pins}`,
  pitch: 0.5,
  span: body,
  terminal: range(0.3, 0.5),
  leadWidth: range(0.18, 0.3),
  bodyAcross: body,
  bodyAlong: body,
  exposedPad,
})

const QFNS = new Map<string, QuadPackage>([
  ["16", hvqfn(16, range(2.9, 3.1), range(1.45, 1.75))],
  ["32", hvqfn(32, range(4.9, 5.1), range(2.95, 3.25))],
  ["48", hvqfn(48, range(6.9, 7.1), range(4.95, 5.25))],
])

/** Pad 1 at the top of the left side; then the bottom left to right, the right side up, the top right to left. */
function quadPads(pins: number, pitch: number, row: PadRow): Pad[] {
  const rising = centredOffsets(pins / 4, pitch)
  const falling = [...rising].reverse()
  const c = row.centre
  const across = (x: number, y: number) => ({ x, y, width: row.length, height: row.width })
  const upright = (x: number, y: number) => ({ x, y, width: row.width, height: row.length })
  const places = [
    ...falling.map((y) => across(-c, y)),
    ...rising.map((x) => upright(x, -c)),
    ...rising.map((y) => across(c, y)),
    ...falling.map((x) => upright(x, c)),
  ]
  return places.map((p, i) => roundRectPad(String(i + 1), p.x, p.y, p.width, p.height))
}

/** LQFP and TQFP differ from each other only in body thickness; both take the QFP footprint. */
const QFP_ALIASES = new Set(["qfp", "lqfp", "tqfp"])
const QUAD_KINDS = new Set(["qfn", ...QFP_ALIASES])

/**
 * The IPC-7351B nominal footprint for "qfp48", "qfn32", "qfn32_ep", and for packages named by body
 * and pitch such as "qfn32_5x5_p0.5_ep3.1" or "lqfp64_10x10_p0.5", or undefined.
 */
export function quadFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (!QUAD_KINDS.has(parsed.kind) || parsed.variant !== undefined) return undefined
  return parsed.size ? namedQuad(parsed, parsed.size) : tableQuad(parsed)
}

function tableQuad(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  const leadless = parsed.kind === "qfn"
  const pkg = leadless ? QFNS.get(parsed.code) : QFPS.get(parsed.code)
  if (!pkg || !isSimple(parsed) || !confirmsPackage(parsed.params, pkg, leadless ? ["ep"] : [])) return undefined
  const thermal = parsed.params["ep"] === true && pkg.exposedPad ? nominalSquare(pkg.exposedPad) : undefined
  return quad(parsed.kind + parsed.code + (thermal ? "_ep" : ""), Number(parsed.code), pkg, leadless, thermal)
}

/**
 * The exposed pad of a cited package takes the drawing's nominal Dh × Eh (the mean of min and max).
 * This is a choice made here: the IPC-7351B rule for thermal pad lands was not seen.
 */
const nominalSquare = (side: Range): Extent => {
  const size = tidy((side.min + side.max) / 2)
  return { x: size, y: size }
}

/** "qfn<N>_<body>x<body>_p<pitch>" with an optional "_ep<size>" or "_ep<w>x<h>", and the QFP forms. */
function namedQuad(parsed: ParsedFootprint, body: Pair): Footprint | Refusal | undefined {
  const leadless = parsed.kind === "qfn"
  const label = leadless ? "QFN" : "QFP"
  const pitch = parsed.params["p"]
  if (parsed.cross !== undefined || parsed.suffix !== undefined) return undefined
  if (typeof pitch !== "number") return refuse(`a ${label} named by its body needs its pitch, such as _p0.5`)
  const pkg = leadless ? qfnPackage(parsed.code, body, pitch) : qfpPackage(parsed.code, body, pitch)
  if (isRefusal(pkg)) return pkg
  const thermal = leadless ? exposedPadSize(parsed, label) : onlyPitch(parsed) ? undefined : refuse("a QFP takes only _p")
  if (isRefusal(thermal)) return thermal
  const name = `${parsed.kind}${parsed.code}_${mm(body[0])}x${mm(body[1])}_p${mm(pitch)}${thermal ? `_ep${sizeText(thermal)}` : ""}`
  return quad(name, Number(parsed.code), pkg, leadless, thermal)
}

function quad(name: string, pins: number, pkg: IcPackage, leadless: boolean, thermal: Extent | undefined): Footprint | Refusal {
  const { row, table } = leadless ? leadlessRow(pkg) : gullWingRow(pkg)
  const signal = quadPads(pins, pkg.pitch, row)
  const pads = thermal ? [...signal, roundRectPad(String(pins + 1), 0, 0, thermal.x, thermal.y)] : signal
  const tooClose = crowded(pads, thermal !== undefined)
  if (tooClose) return tooClose
  const half = pkg.bodyAcross.max / 2
  const reach = Math.max(pkg.span.max, pkg.bodyAcross.max) / 2
  return {
    name,
    pads,
    courtyard: courtyard(pads, { x: reach, y: reach }, table),
    silkscreen: quadSilkscreen(signal, { x: half, y: half }),
    fabrication: bodyOutline({ x: half, y: half }),
    origin: `IPC-7351B nominal, ${pkg.label}${thermal ? " with exposed pad" : ""}`,
  }
}
