import { mm } from "./exposed.js"
import { THROUGH_HOLE_COURTYARD } from "./ipc7251.js"
import { arcPoints, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * "wirepad<land>_d<hole>": one round plated pad with a hole through it, for soldering a wire or a pin to the board
 * (the IN+ / OUT- pads at the corners of a module). The land and hole are the person's: the string gives them.
 */

/** The copper ring round the hole must be at least this wide to be made and to hold a wire (JLCPCB's 0.15 mm minimum
 * annular ring and more). */
const MIN_RING = 0.25
/** Bounds that only keep a string sane. */
const MIN_HOLE = 0.3
const MAX_LAND = 10

export function wirepadFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "wirepad") return undefined
  const plain = parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined && parsed.variant === undefined && parsed.cross === undefined
  const land = Number(parsed.code)
  const hole = parsed.params["d"]
  const others = Object.keys(parsed.params).filter((key) => key !== "d")
  if (!plain || others.length > 0 || typeof hole !== "number" || !Number.isFinite(land)) {
    return refuse("a wire pad is wirepad<land>_d<hole> in mm, such as wirepad2.5_d1.2")
  }
  if (hole < MIN_HOLE || land > MAX_LAND) return refuse(`the hole is at least ${MIN_HOLE} mm and the land at most ${MAX_LAND} mm`)
  if ((land - hole) / 2 < MIN_RING) return refuse(`a ${mm(land)} mm land round a ${mm(hole)} mm hole leaves less than a ${MIN_RING} mm ring: make the land at least ${mm(hole + 2 * MIN_RING)} mm`)
  const pad: Pad = { number: "1", shape: "circle", x: 0, y: 0, width: land, height: land, rotation: 0, layers: "through", drill: { width: hole, height: hole } }
  return {
    name: `wirepad${mm(land)}_d${mm(hole)}`,
    pads: [pad],
    courtyard: courtyard([pad], { x: land / 2, y: land / 2 }, THROUGH_HOLE_COURTYARD),
    silkscreen: [],
    fabrication: [arcPoints({ x: 0, y: 0 }, land / 2, 0, 360, 10)],
    origin: `Through-hole wire pad: a ${mm(land)} mm round land with a ${mm(hole)} mm hole, as given`,
  }
}
