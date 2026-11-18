import { mm } from "./exposed.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { centredOffsets, closedRectangle, courtyard, pinOneTick, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * PCB screw terminal blocks, "screw<N>" with an optional `_p<pitch>`: N poles in a row along x.
 *
 * Written from general knowledge of terminal block makers' drawings, not transcribed from one:
 * - solder pins 1.0 × 1.0 mm square (±0.05), whose diagonal sets the hole and land by IPC-2222;
 * - the block is N × pitch long; 9.0 mm deep for 5.0 and 5.08 mm pitch and 7.0 mm deep for 3.5 and
 *   3.81 mm pitch, centred on the pin row here (real blocks often sit the pins off the depth centre:
 *   the outline is a guide, a part's own drawing should confirm).
 */
const PITCHES: readonly number[] = [3.5, 3.81, 5, 5.08]
const DEFAULT_PITCH = 5.08
const PIN = range(0.95, 1.05)
const MIN_POLES = 2
const MAX_POLES = 24
const DEEP = 9.0
const SHALLOW = 7.0
const DEEP_FROM = 5
/** The pin 1 tick sits this far outside the body outline. */
const TICK_GAP = 0.3
/** The courtyard holds the tick with this much to spare. */
const TICK_ROOM = 0.1

export function screwFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  const plain = parsed.cross === undefined && parsed.suffix === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (parsed.kind !== "screw" || !plain || Object.keys(parsed.params).some((key) => key !== "p")) return undefined
  const poles = Number(parsed.code)
  const pitch = parsed.params["p"] ?? DEFAULT_PITCH
  if (parsed.code === "" || !Number.isInteger(poles) || poles < MIN_POLES || poles > MAX_POLES) {
    return refuse(`a screw terminal block has ${MIN_POLES} to ${MAX_POLES} poles: screw<N>, such as screw2`)
  }
  if (pitch === true || !PITCHES.includes(pitch)) return refuse(`screw terminal blocks come at ${PITCHES.join(", ")} mm pitch`)
  const land = throughHoleLand(leadDiameter(PIN, PIN))
  const pads: Pad[] = centredOffsets(poles, pitch).map((x, i) => throughHolePad(String(i + 1), x, 0, land, i === 0))
  const body = { x: tidy((poles * pitch) / 2), y: (pitch >= DEEP_FROM ? DEEP : SHALLOW) / 2 }
  const tickY = tidy(-(body.y + TICK_GAP))
  return {
    name: `screw${poles}_p${mm(pitch)}mm`,
    pads,
    courtyard: courtyard(pads, { x: body.x, y: body.y + TICK_GAP + TICK_ROOM }, THROUGH_HOLE_COURTYARD),
    silkscreen: [closedRectangle(body), pinOneTick(pads[0] as Pad, tickY)],
    fabrication: [closedRectangle(body)],
    origin: `Through-hole screw terminal block, ${poles} poles at ${mm(pitch)} mm, 1 mm square pins: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B); body typical`,
  }
}
