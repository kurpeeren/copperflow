// One part alone, as the Packages dialog shows it: the faces of the shape its footprint string gives, standing on
// z = 0 (the board's top), in its own frame, with its bounds, and a small patch of board under it to stand on.
// Built from the same pieces the 3D view draws a placed part with (index.ts). Pure.
import { generateFootprint } from "../../../../src/engine/footprints/index.js"
import type { Footprint } from "../../../../src/engine/footprints/types.js"
import type { PlacedFootprint } from "../../../../src/engine/pcb.js"
import { partHeight, type PartHeight } from "../../../../src/engine/solid/heights.js"
import { plainBoardColours } from "../paint.js"
import type { Face, Scene, Vec3 } from "../scene.js"
import { FAMILY_LOOKS, familyOf } from "./family.js"
import { prism, rectOf, type Rect } from "./kit.js"
import { ledLook } from "./ledth.js"
import { SHAPES, shapeInput } from "./index.js"

/** The board the part stands on, in mm: as thick as the usual board, so through-hole leads look right. */
const PATCH_THICKNESS = 1.6
/** How far the patch reaches past the part's courtyard, in mm. */
const PATCH_MARGIN = 1

export interface LonePart {
  faces: Face[]
  /** The smallest box around the part's faces, as [min, max]. */
  bounds: [Vec3, Vec3]
  /** Its height and where that comes from (partHeight). */
  height: PartHeight
  /** The courtyard's bounds, for the patch under it. */
  limit: Rect
}

const NOT_A_STRING = (name: string) => `"${name}" is not a footprint string; a part's own footprint.yaml has no shape to show here`

/** The footprint the string makes, or why it cannot be made. */
function footprintOf(text: string): Footprint | { error: string } {
  const name = text.trim()
  if (name === "") return { error: "Type a footprint string such as soic8 or 0603." }
  if (name.includes("/")) return { error: NOT_A_STRING(name) }
  return generateFootprint(name)
}

/** The part placed at the origin, unturned, on the top: what shapeInput reads. */
const placedAtOrigin = (footprint: Footprint): PlacedFootprint => ({
  component: "",
  x: 0,
  y: 0,
  rotation: 0,
  side: "top",
  autoPlaced: false,
  footprint,
  pads: [],
  courtyard: footprint.courtyard,
  silkscreen: footprint.silkscreen,
  fabrication: footprint.fabrication,
})

function boundsOf(faces: readonly Face[]): [Vec3, Vec3] {
  const points = faces.flatMap((face) => face.loops.flat())
  if (points.length === 0) return [[0, 0, 0], [0, 0, 0]]
  const axis = (i: 0 | 1 | 2) => points.map((p) => p[i])
  const [xs, ys, zs] = [axis(0), axis(1), axis(2)]
  return [
    [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  ]
}

/**
 * The faces of the part a footprint string makes, `kind` (such as "resistor") choosing its colours as on the board;
 * an error in plain words when the string cannot be made.
 */
export function lonePart(text: string, kind = ""): LonePart | { error: string } {
  const footprint = footprintOf(text)
  if ("error" in footprint) return { error: footprint.error }
  const name = text.trim()
  const height = partHeight({ footprint: name, props: {} })
  const through = footprint.pads.some((pad) => pad.layers === "through")
  const { family, look, parsed } = familyOf(kind, name, through)
  const paint = family === "ledth" ? ledLook(FAMILY_LOOKS[look], undefined) : FAMILY_LOOKS[look]
  const input = shapeInput(placedAtOrigin(footprint), height.height, paint, parsed, PATCH_THICKNESS, look)
  const faces = SHAPES[family](input).map((piece): Face => ({ ...piece, alpha: 1, part: 0 }))
  return { faces, bounds: boundsOf(faces), height, limit: input.limit }
}

/** The part on a small patch of board (its top at z = 0), as a scene the 3D drawing takes. */
export function loneScene(part: LonePart): Scene {
  const box = rectOf([
    { x: Math.min(part.limit.minX, part.bounds[0][0]) - PATCH_MARGIN, y: Math.min(part.limit.minY, part.bounds[0][1]) - PATCH_MARGIN },
    { x: Math.max(part.limit.maxX, part.bounds[1][0]) + PATCH_MARGIN, y: Math.max(part.limit.maxY, part.bounds[1][1]) + PATCH_MARGIN },
  ]) as Rect
  const outline = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]
  const { mask, laminate } = plainBoardColours({})
  const patch = prism(outline, -PATCH_THICKNESS, 0, { top: mask, side: laminate }, "matt", "board").map((piece): Face => ({ ...piece, alpha: 1, part: -1 }))
  const faces = [...part.faces, ...patch]
  return { faces, bounds: boundsOf(faces) }
}
