import { gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type Range } from "./ipc7351.js"
import { bodyOutline, centredOffsets, courtyard, dualSilkscreen, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * Surface-mount DIP: a 300 mil DIP body with its leads bent out to gull wings, as optocouplers and
 * small DIP parts come in their "SMD" or "gull wing" lead option. Typical values written from general
 * knowledge of makers' drawings of that option, not transcribed from one drawing: pitch 2.54, overall
 * span over the lead toes 9.40–10.16, foot 0.76–1.27, lead width 0.40–0.60 at the foot, body width
 * 6.35–6.60, body length per pin count below. A part's own drawing should confirm.
 */
const PITCH = 2.54
const SPAN = range(9.4, 10.16)
const FOOT = range(0.76, 1.27)
const LEAD_WIDTH = range(0.4, 0.6)
const BODY_WIDTH = range(6.35, 6.6)

const BODY_LENGTH = new Map<string, Range>([
  ["4", range(4.4, 4.8)],
  ["6", range(7.0, 7.4)],
  ["8", range(9.4, 9.9)],
  ["16", range(19.8, 20.3)],
])

function smdipPackage(pins: string, bodyAlong: Range): IcPackage {
  return { label: `SMD DIP-${pins}`, pitch: PITCH, span: SPAN, terminal: FOOT, leadWidth: LEAD_WIDTH, bodyAcross: BODY_WIDTH, bodyAlong }
}

/** Pad 1 at the top of the left column; the left column runs down, the right column back up, as a DIP. */
function smdipPads(pins: number, pkg: IcPackage): Pad[] {
  const { row } = gullWingRow(pkg)
  const ys = centredOffsets(pins / 2, pkg.pitch)
  const left = [...ys].reverse().map((y, i) => roundRectPad(String(i + 1), -row.centre, y, row.length, row.width))
  const right = ys.map((y, i) => roundRectPad(String(pins / 2 + i + 1), row.centre, y, row.length, row.width))
  return [...left, ...right]
}

const COUNTS = [...BODY_LENGTH.keys()]

/** The IPC-7351B nominal footprint for "smdip4", "smdip6", "smdip8", "smdip16"; a refusal for another count; or undefined. */
export function smdipFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "smdip") return undefined
  const bodyAlong = BODY_LENGTH.get(parsed.code)
  if (!bodyAlong) return refuse(`a surface-mount DIP has ${COUNTS.slice(0, -1).join(", ")} or ${COUNTS[COUNTS.length - 1]} pins`)
  if (!isSimple(parsed) || parsed.variant !== undefined || Object.keys(parsed.params).length > 0) return refuse("a surface-mount DIP takes no variant or parameters")
  const pkg = smdipPackage(parsed.code, bodyAlong)
  const { table } = gullWingRow(pkg)
  const pads = smdipPads(Number(parsed.code), pkg)
  const body = { x: tidy(BODY_WIDTH.max / 2), y: tidy(bodyAlong.max / 2) }
  return {
    name: `smdip${parsed.code}`,
    pads,
    courtyard: courtyard(pads, { x: SPAN.max / 2, y: body.y }, table),
    silkscreen: dualSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
