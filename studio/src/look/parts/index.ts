// Every part of a design as lit simple shapes in the board's frame: each part's family (family.ts) picks the function
// that shapes it from its pads, courtyard, body outline and height, in its own frame; the pieces are then turned,
// mirrored and moved as the PCB places the part, standing on the board's top or hanging below its bottom. Pure.
import type { Design } from "../../../../src/engine/design.js"
import { trimmerShape } from "./trimmer.js"
import type { PlacedFootprint } from "../../../../src/engine/pcb.js"
import type { SolidModel } from "../../../../src/engine/solid/model.js"
import type { Face, Vec3 } from "../scene.js"
import { axialShape } from "./axial.js"
import { ledLook, ledShape } from "./ledth.js"
import { screwShape } from "./screw.js"
import { socketShape } from "./socket.js"
import { bgaShape } from "./bga.js"
import { blockShape, plainBox } from "./block.js"
import { crystalShape, electrolyticShape } from "./cans.js"
import { chipShape } from "./chip.js"
import { FAMILY_LOOKS, familyOf, type Family } from "./family.js"
import { dipShape } from "./dip.js"
import { gullwingShape } from "./gullwing.js"
import { headerShape } from "./header.js"
import type { ShapeInput } from "./input.js"
import { rectOf, type Piece, type Rect } from "./kit.js"
import { leadlessShape } from "./leadless.js"
import { moldedShape } from "./molded.js"
import { SMD_SHAPES } from "./smd-shapes.js"
import { UNO_SHAPES } from "./uno-shapes.js"
import { tabShape } from "./tab.js"
import { to220Shape } from "./to220.js"
import { to92Shape } from "./to92.js"

export const SHAPES: Record<Family, (input: ShapeInput) => Piece[]> = {
  chip: chipShape,
  molded: moldedShape,
  gullwing: gullwingShape,
  leadless: leadlessShape,
  header: headerShape,
  crystal: crystalShape,
  electrolytic: electrolyticShape,
  block: blockShape,
  box: plainBox,
  bga: bgaShape,
  dip: dipShape,
  to220: to220Shape,
  to92: to92Shape,
  tab: tabShape,
  axial: axialShape,
  ledth: ledShape,
  trimmer: trimmerShape,
  // A bare pad has no body: the board picture already shows its tinned copper.
  bare: () => [],
  screw: screwShape,
  socket: socketShape,
  ...SMD_SHAPES,
  ...UNO_SHAPES,
}

const FALLBACK: Rect = { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 }

/** The part's own frame to the board's: turned, mirrored on the bottom, moved; z from the board's surface outwards. */
function placer(part: PlacedFootprint, thickness: number) {
  const r = (part.rotation * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  const bottom = part.side === "bottom"
  const point = (p: Vec3): Vec3 => {
    const [x, y] = [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
    return [part.x + (bottom ? -x : x), part.y + y, bottom ? -p[2] : thickness + p[2]]
  }
  const normal = (n: Vec3): Vec3 => {
    const [x, y] = [n[0] * c - n[1] * s, n[0] * s + n[1] * c]
    return [bottom ? -x : x, y, bottom ? -n[2] : n[2]]
  }
  return { point, normal }
}

/** The shape input of one placed part, in its own frame. */
export function shapeInput(part: PlacedFootprint, height: number, look: ShapeInput["look"], parsed: ShapeInput["parsed"], thickness: number, lookName?: string, props?: ShapeInput["props"]): ShapeInput {
  const footprint = part.footprint
  const limit = rectOf(footprint?.courtyard ?? []) ?? rectOf((footprint?.pads ?? []).map((p) => ({ x: p.x, y: p.y }))) ?? FALLBACK
  const body = rectOf((footprint?.fabrication ?? []).flat())
  return { pads: footprint?.pads ?? [], height, limit, ...(body ? { body } : {}), ...(footprint?.fabrication.length ? { outlines: footprint.fabrication } : {}), look, ...(lookName ? { lookName } : {}), ...(parsed ? { parsed } : {}), ...(props ? { props } : {}), thickness }
}

/** Every part's faces; each face carries its part's index in the model. */
export function partFaces(design: Design, model: SolidModel): Face[] {
  const thickness = model.board?.thickness ?? model.parts.find((p) => p.side === "top")?.bottom ?? 1.6
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  return design.pcb.parts.flatMap((part, index) => {
    const solid = model.parts[index]
    if (solid === undefined) return []
    const component = components.get(part.component)
    const through = part.pads.some((pad) => pad.layers === "through")
    const { family, look, parsed } = familyOf(component?.kind ?? "", component?.footprint, through, part.component)
    const paint = family === "ledth" ? ledLook(FAMILY_LOOKS[look], component?.props) : FAMILY_LOOKS[look]
    const input = shapeInput(part, solid.height, paint, parsed, thickness, look, component?.props)
    const shaped = part.footprint === undefined ? [] : SHAPES[family](input)
    const pieces = shaped.length === 0 && family !== "bare" ? plainBox(input) : shaped
    const place = placer(part, thickness)
    return pieces.map((piece): Face => ({
      loops: piece.loops.map((loop) => loop.map(place.point)),
      normal: place.normal(piece.normal),
      color: piece.color,
      alpha: piece.alpha ?? 1,
      part: index,
      material: piece.material,
      role: piece.role,
    }))
  })
}
