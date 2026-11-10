import { dualPads } from "./dual.js"
import { exposedPadSize, MIN_PAD_GAP, mm, sizeText } from "./exposed.js"
import { leadlessRow } from "./ic.js"
import { roundRectPad } from "./ipc7351.js"
import { dfnPackage } from "./jedec.js"
import { bodyOutline, courtyard, dualSilkscreen, padsApart } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint } from "./types.js"

/**
 * The IPC-7351B nominal footprint for "dfn<N>_<across>x<along>_p<pitch>", with an optional
 * "_ep<size>" or "_ep<w>x<h>" exposed pad, or undefined. The terminals sit in two columns, left and
 * right, across the first body size; pad 1 is at the top of the left column and the numbers run
 * counter-clockwise, as for a SOIC.
 *
 * IPC-7351B gives small outline no-lead packages (SON) their own goal table, Table 3-16; no source
 * for its values was at hand, so the QFN goals of Table 3-15 (toe 0.30, heel 0, side −0.04) are
 * used, the same terminal form on two sides instead of four.
 */
export function dfnFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const body = parsed.size
  const pitch = parsed.params["p"]
  if (parsed.kind !== "dfn" || !body || typeof pitch !== "number") return undefined
  if (parsed.variant !== undefined || parsed.cross !== undefined || parsed.suffix !== undefined) return undefined
  const pkg = dfnPackage(parsed.code, body, pitch)
  const thermal = exposedPadSize(parsed)
  if (!pkg || thermal === null) return undefined
  const pins = Number(parsed.code)
  const { row, table } = leadlessRow(pkg)
  const signal = dualPads(pins, pitch, row)
  const pads = thermal ? [...signal, roundRectPad(String(pins + 1), 0, 0, thermal.x, thermal.y)] : signal
  if (!padsApart(pads, MIN_PAD_GAP)) return undefined
  const half = { x: pkg.bodyAcross.max / 2, y: pkg.bodyAlong.max / 2 }
  return {
    name: `dfn${pins}_${mm(body[0])}x${mm(body[1])}_p${mm(pitch)}${thermal ? `_ep${sizeText(thermal)}` : ""}`,
    pads,
    courtyard: courtyard(pads, half, table),
    silkscreen: dualSilkscreen(signal, half),
    fabrication: bodyOutline(half),
    origin: `IPC-7351B nominal, ${pkg.label}${thermal ? " with exposed pad" : ""}`,
  }
}
