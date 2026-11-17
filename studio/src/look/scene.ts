// The 3D view's scene: the solids of the design (src/engine/solid/model.ts) as flat faces to draw. The board's top and
// bottom are one face each with its holes as further loops; its sides and the holes' walls are quads, an arc cut into
// short straight pieces; each part's box is six quads. Faces carry their outward normal, colour and translucency, and
// the index of the part they belong to (-1 for the board). Pure.
import { arcSweep, type PartSolid, type Segment, type SolidModel } from "../../../src/engine/solid/model.js"
import { PALETTE } from "../pcb/ctx.js"

export type Vec3 = readonly [number, number, number]
export type Rgb = readonly [number, number, number]

/** How a lit face takes the light: plastic and laminate are matt, metal has a soft highlight. */
export type Material = "matt" | "metal"

/** What a face is part of, for the tests and for drawing: a part's body, an end cap, a leg, a pin, a lead below the board, a mark. */
export type Role = "body" | "cap" | "leg" | "pin" | "lead" | "pin1" | "cathode" | "board"

/** A colour that changes across a face, at a point of the board's space: the board's picture or its edge. */
export interface Paint {
  /** Writes the colour (0 to 255) at x, y, z into out[0..2] and answers its alpha, 0 to 1; 0 leaves the pixel to what is behind. */
  at(x: number, y: number, z: number, out: Float32Array, fine: boolean): number
}

export interface Face {
  /** The first loop is the outline, any others are holes; all in one plane. */
  loops: Vec3[][]
  /** Pointing out of the solid. */
  normal: Vec3
  color: Rgb
  /** 1 is opaque. */
  alpha: number
  /** The part's index in the model's parts, or -1 for the board. */
  part: number
  material?: Material
  role?: Role
  /** Colour from a paint instead of `color`. */
  paint?: Paint
}

export interface Scene {
  faces: Face[]
  /** The smallest box around everything, as [min, max]. */
  bounds: [Vec3, Vec3]
}

/** How see-through the board is: enough to see the through-hole parts on the far side. */
export const BOARD_ALPHA = 0.45
const BOARD_COLOR: Rgb = [40, 120, 70]

/** A "#rrggbb" colour as numbers. */
export function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** Parts in the PCB view's colours for their side: the assembly layer's. */
export const sideColor = (side: PartSolid["side"]): Rgb => rgb(side === "top" ? PALETTE.topAssembly : PALETTE.bottomAssembly)

/** At most this turn, in radians, per straight piece of an arc. */
const ARC_STEP = Math.PI / 12

/** The points a loop passes through, an arc cut into short pieces; each segment's end is the next one's start. */
function loopPoints(loop: readonly Segment[]): { x: number; y: number }[] {
  return loop.flatMap((segment) => {
    if (segment.kind === "line") return [segment.from]
    const sweep = arcSweep(segment)
    const pieces = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP))
    const start = Math.atan2(segment.from.y - segment.centre.y, segment.from.x - segment.centre.x)
    return Array.from({ length: pieces }, (_, i) => {
      const angle = start + (sweep * i) / pieces
      return i === 0 ? segment.from : { x: segment.centre.x + segment.radius * Math.cos(angle), y: segment.centre.y + segment.radius * Math.sin(angle) }
    })
  })
}

/** A prism's faces: top, bottom and a quad per edge of each loop (the first loop counter-clockwise, holes clockwise). */
function prismFaces(loops: readonly { x: number; y: number }[][], z0: number, z1: number, color: Rgb, alpha: number, part: number): Face[] {
  const at = (z: number) => (p: { x: number; y: number }): Vec3 => [p.x, p.y, z]
  const top: Face = { loops: loops.map((loop) => loop.map(at(z1))), normal: [0, 0, 1], color, alpha, part }
  const bottom: Face = { loops: loops.map((loop) => [...loop].reverse().map(at(z0))), normal: [0, 0, -1], color, alpha, part }
  const sides = loops.flatMap((loop) =>
    loop.map((p, i): Face => {
      const q = loop[(i + 1) % loop.length] as { x: number; y: number }
      const length = Math.hypot(q.x - p.x, q.y - p.y) || 1
      return { loops: [[at(z0)(p), at(z0)(q), at(z1)(q), at(z1)(p)]], normal: [(q.y - p.y) / length, -(q.x - p.x) / length, 0], color, alpha, part }
    }),
  )
  return [top, bottom, ...sides]
}

export function buildScene(model: SolidModel): Scene {
  const board = model.board
  const boardFaces = board ? prismFaces([board.outline, ...board.holes].map(loopPoints), 0, board.thickness, BOARD_COLOR, BOARD_ALPHA, -1) : []
  const partFaces = model.parts.flatMap((part, index) => prismFaces([part.corners], part.bottom, part.top, sideColor(part.side), 1, index))
  const faces = [...partFaces, ...boardFaces]
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const point of faces.flatMap((face) => face.loops.flat())) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] as number, point[axis] as number)
      max[axis] = Math.max(max[axis] as number, point[axis] as number)
    }
  }
  const empty = faces.length === 0
  return { faces, bounds: empty ? [[0, 0, 0], [0, 0, 0]] : [min as unknown as Vec3, max as unknown as Vec3] }
}
